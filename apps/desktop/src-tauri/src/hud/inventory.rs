//! 物品栏原生窗口：容器背景、格子图标、悬停蒙版、拖动与文件拖放。

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{mpsc, Once, OnceLock};
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::hud::config::Point;
use crate::hud::inventory_draw::{self, Layout, SlotIcon, Style};
use crate::hud::sprite::{self, Frame};
use crate::hud::text;
use crate::hud::tooltip;
use crate::hud::{dragicon, win32 as w};
use crate::hud::win32::Dib;
use crate::slots::{self, Scope, SlotItem};

pub const TIMER_HOVER: usize = 1;
/// 屏幕范围的光标跟踪定时器
const TIMER_LOOK: usize = 2;
/// 跟随刷新率的采样间隔，拖动与移动都平滑
const LOOK_INTERVAL_MS: u64 = 16;
/// 扫格期间由采样线程投递的光标位置消息
const WM_SHIFT_SAMPLE: u32 = w::WM_APP + 1;
/// 外部拖放结束后收回前台焦点
const WM_DROP_FOCUS: u32 = w::WM_APP + 3;
/// 采样间隔：鼠标消息会被系统合并，直接轮询光标才能跟上快速扫格
const SHIFT_SAMPLE_MS: u64 = 1;
const LONG_PRESS_MS: u64 = 150;
const DRAG_THRESHOLD: f32 = 10.0;
const HOVER_GREEN_MS: u64 = 250;
const DOUBLE_CLICK_MS: u64 = 500;
const OUTSIDE_MARGIN: f32 = 4.0;
/// 扫格插值的步长，按界面像素计，保证穿过任意格子都至少采样三次
const SWEEP_STEP: f32 = 6.0;
/// 单次移动补采样的上限，防止异常坐标跳变拖住消息循环
const SWEEP_MAX_POINTS: usize = 128;
const ICON_MIN: f32 = 32.0;
const ICON_MAX: f32 = 128.0;

static SHIFT_SAMPLING: AtomicBool = AtomicBool::new(false);
static SHIFT_HWND: AtomicIsize = AtomicIsize::new(0);
static SHIFT_WAKE: OnceLock<mpsc::Sender<()>> = OnceLock::new();

/// 扫格期间不用系统合并后的鼠标消息，改为固定频率采样光标位置。
fn install_shift_sampler(hwnd: w::Hwnd) {
    static ONCE: Once = Once::new();
    SHIFT_HWND.store(hwnd, Ordering::Relaxed);
    ONCE.call_once(|| {
        let (wake, sleep) = mpsc::channel::<()>();
        let _ = SHIFT_WAKE.set(wake);
        std::thread::spawn(move || {
            let mut last = w::Point { x: i32::MIN, y: i32::MIN };
            loop {
                if !SHIFT_SAMPLING.load(Ordering::Relaxed) {
                    let _ = sleep.recv_timeout(Duration::from_millis(50));
                    continue;
                }
                std::thread::sleep(Duration::from_millis(SHIFT_SAMPLE_MS));
                if !SHIFT_SAMPLING.load(Ordering::Relaxed) {
                    continue;
                }
                // 左键已松开就不再补发，避免松手后的移动被算进扫格
                if !w::key_down(0x01) {
                    continue;
                }
                let cursor = w::cursor_pos();
                if cursor.x == last.x && cursor.y == last.y {
                    continue;
                }
                last = cursor;
                let hwnd = SHIFT_HWND.load(Ordering::Relaxed);
                if hwnd == 0 {
                    continue;
                }
                let point = w::to_client(hwnd, cursor);
                // 与鼠标消息使用同样的坐标打包方式
                let packed = ((point.x as u32 & 0xffff) | ((point.y as u32 & 0xffff) << 16)) as isize;
                w::post_message(hwnd, WM_SHIFT_SAMPLE, 0, packed);
            }
        });
    });
}

fn start_shift_sampler() {
    if !SHIFT_SAMPLING.swap(true, Ordering::Relaxed) {
        // SAFETY: 只提升本进程的定时器精度，扫格结束会恢复
        unsafe {
            w::timeBeginPeriod(1);
        }
        if let Some(wake) = SHIFT_WAKE.get() {
            let _ = wake.send(());
        }
    }
}

fn stop_shift_sampler() {
    if SHIFT_SAMPLING.swap(false, Ordering::Relaxed) {
        // SAFETY: 与 timeBeginPeriod 成对恢复
        unsafe {
            w::timeEndPeriod(1);
        }
        if let Some(wake) = SHIFT_WAKE.get() {
            let _ = wake.send(());
        }
    }
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlayerCfg {
    pub skin_name: String,
    pub skin_type: String,
    pub skin_path: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct InventoryCfg {
    pub visible: bool,
    pub locked: bool,
    pub remember_position: bool,
    pub position: Option<Point>,
    pub gray_overlay: bool,
    pub gray_overlay_opacity: f64,
    pub hide_status_bar: bool,
    pub click_mode: String,
    pub style: String,
    pub shared_data: bool,
    pub hover_effect: bool,
    pub show_model: bool,
    pub show_tooltip: bool,
    pub tooltip_show_file_name: bool,
    pub tooltip_show_original_name: bool,
    pub tooltip_show_file_path: bool,
    pub tooltip_show_file_type: bool,
    pub file_name_color: String,
    pub cut_slot: Option<String>,
    pub drop_key: String,
    pub open_inventory: String,
    pub player: PlayerCfg,
}

impl Default for InventoryCfg {
    fn default() -> Self {
        InventoryCfg {
            visible: false,
            locked: false,
            remember_position: false,
            position: None,
            gray_overlay: true,
            gray_overlay_opacity: 75.0,
            hide_status_bar: false,
            click_mode: "single".into(),
            style: "inventory.png".into(),
            shared_data: true,
            hover_effect: true,
            show_model: true,
            show_tooltip: false,
            tooltip_show_file_name: true,
            tooltip_show_original_name: false,
            tooltip_show_file_path: false,
            tooltip_show_file_type: false,
            file_name_color: "#FCFCFC".into(),
            cut_slot: None,
            drop_key: "q".into(),
            open_inventory: "e".into(),
            player: PlayerCfg::default(),
        }
    }
}

impl InventoryCfg {
    pub fn scope(&self) -> Scope {
        Scope { style: self.style.clone(), shared: self.shared_data }
    }
}

pub struct Press {
    slot: usize,
    x: f32,
    y: f32,
    at: u64,
}

pub struct Drag {
    source: usize,
    target: usize,
    x: f32,
    y: f32,
}

struct WindowMove {
    cursor: w::Point,
    origin: (i32, i32),
}

struct Distribute {
    source: usize,
    path: String,
    last: Option<usize>,
}

/// 物品栏内的局部快捷键序列
static KEY_SEQUENCE: std::sync::Mutex<crate::hotkeys::SequenceState> =
    std::sync::Mutex::new(crate::hotkeys::SequenceState::new());

pub struct State {
    app: AppHandle,
    hwnd: w::Hwnd,
    config: InventoryCfg,
    style: Style,
    layout: Layout,
    unit: f32,
    dpi: f32,
    background: Rc<sprite::Sprite>,
    icons: Vec<Option<SlotIcon>>,
    icon_keys: Vec<String>,
    /// 已交给系统拖放的格子，拖放结束前不参与图标刷新
    drag_source: Option<usize>,
    /// 拖出交接时暂存的图标与 key，取消时还回
    hidden_icon: Option<(Option<SlotIcon>, String)>,
    hover: Option<usize>,
    hover_at: u64,
    drop_hover: Option<usize>,
    press: Option<Press>,
    drag: Option<Drag>,
    moving: Option<WindowMove>,
    distribute: Option<Distribute>,
    shift_sweeping: bool,
    last_shift_slot: Option<usize>,
    left_down: bool,
    q_down: bool,
    last_dropped: Option<usize>,
    /// 上一次鼠标位置，扫格时用它补齐两帧之间跳过的格子
    last_move: Option<(f32, f32)>,
    last_click_slot: Option<usize>,
    last_click_at: u64,
    tooltip_slot: Option<usize>,
    /// 预览尺寸与皮肤指纹，变化时通知离屏窗口重建模型
    entity_meta: Option<String>,
    /// 3D 预览覆盖层窗口，就绪后由玩家区域跟随物品栏移动
    entity_hwnd: w::Hwnd,
    /// 上一次已下发的（光标位置 + 窗口位置），空闲时不重复发送
    look_cursor: Option<(i32, i32, i32, i32)>,
    /// 屏幕跟踪定时器是否在运行
    look_timer: bool,
    tracked: bool,
    frame: Option<Frame>,
    dib: Option<Dib>,
    rect: Option<(i32, i32, u32, u32)>,
    shown: bool,
    visible: bool,
    hidden_status_bar: bool,
    /// 第一份配置到达前不显示窗口，避免用默认样式闪一下
    configured: bool,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

pub fn with_state<T>(f: impl FnOnce(&mut State) -> T) -> Option<T> {
    STATE.with(|cell| {
        let mut slot = cell.try_borrow_mut().ok()?;
        slot.as_mut().map(f)
    })
}

pub fn init(app: &AppHandle) {
    let hwnd = w::create_named_window("CraftSharpInventory", "物品栏", wndproc, 0);
    if hwnd == 0 {
        return;
    }
    crate::dragdrop::install(app, "inventory", hwnd);
    install_shift_sampler(hwnd);

    let style = inventory_draw::find_style("inventory.png");
    let background = inventory_draw::container_sprite(style).unwrap_or_else(|| Rc::new(sprite::Sprite { width: 176, height: 166, pixels: Vec::new() }));
    let layout = inventory_draw::compute(style, 6.0, &background);

    let state = State {
        app: app.clone(),
        hwnd,
        config: InventoryCfg::default(),
        style,
        layout,
        unit: 6.0,
        dpi: 1.0,
        background,
        icons: Vec::new(),
        icon_keys: Vec::new(),
        drag_source: None,
        hidden_icon: None,
        hover: None,
        hover_at: 0,
        drop_hover: None,
        press: None,
        drag: None,
        moving: None,
        distribute: None,
        shift_sweeping: false,
        last_shift_slot: None,
        left_down: false,
        q_down: false,
        last_dropped: None,
        last_move: None,
        last_click_slot: None,
        last_click_at: 0,
        tooltip_slot: None,
        entity_meta: None,
        entity_hwnd: 0,
        look_cursor: None,
        look_timer: false,
        tracked: false,
        frame: None,
        dib: None,
        rect: None,
        shown: false,
        visible: false,
        hidden_status_bar: false,
        configured: false,
    };
    STATE.with(|cell| *cell.borrow_mut() = Some(state));
}

/// 配置推送：重建布局、处理显隐、按需重载图标。
pub fn apply(config: InventoryCfg) {
    with_state(|state| {
        let style = inventory_draw::find_style(&config.style);
        let style_changed = style.file != state.style.file;
        let shared_changed = config.shared_data != state.config.shared_data;
        let visible_changed = config.visible != state.visible;
        let hide_changed = config.hide_status_bar != state.config.hide_status_bar;
        let overlay_changed = config.gray_overlay != state.config.gray_overlay
            || (config.gray_overlay_opacity - state.config.gray_overlay_opacity).abs() > f64::EPSILON;
        let model_changed = config.show_model != state.config.show_model;
        state.config = config;
        state.configured = true;
        let scope = state.config.scope();
        slots::register_scope("inventory", &scope.style, scope.shared);
        // 分发期间每次落格都由原生即时刷新，配置回传只更新镜像，
        // 不再触发第二次布局/重绘，避免跟手浮层抖动
        let data_only = !style_changed && !shared_changed && !visible_changed && !hide_changed && !overlay_changed;
        if state.distribute.is_some() && data_only {
            return;
        }
        if style_changed {
            if let Some(sprite) = inventory_draw::container_sprite(style) {
                state.style = style;
                state.background = sprite;
            }
        }
        if style_changed {
            // 样式变化后格子数量与位置都变了，旧索引一律作废
            hide_tooltip(state);
            state.hover = None;
            state.drop_hover = None;
            state.press = None;
            state.drag = None;
            state.drag_source = None;
            state.hidden_icon = None;
            state.distribute = None;
            state.last_shift_slot = None;
            stop_shift_sampler();
            state.last_click_slot = None;
        }
        rebuild_layout(state, style_changed || state.rect.is_none());
        if state.config.visible {
            refresh_icons(state);
        }
        if visible_changed || model_changed || (state.visible && (overlay_changed || hide_changed)) {
            set_visible_inner(state);
        }
        refresh_tooltip(state);
        sync_entity_setup(state);
        render(state);
    });
}

fn rebuild_layout(state: &mut State, reposition: bool) {
    state.dpi = w::dpi_of(state.hwnd).max(1.0);
    let monitor = w::monitor_rect(state.hwnd);
    let logical_width = (monitor.right - monitor.left) as f32 / state.dpi;
    let scale = (logical_width / 2560.0 * 6.0).max(1.0);
    state.unit = scale * state.dpi;
    state.layout = inventory_draw::compute(state.style, state.unit, &state.background);
    state.icons.resize(state.layout.slots.len(), None);
    state.icon_keys.resize(state.layout.slots.len(), String::new());
    if reposition || state.rect.is_none() {
        apply_geometry(state);
    } else if let Some((x, y, old_width, old_height)) = state.rect {
        let width = state.layout.width.ceil().max(1.0) as u32;
        let height = state.layout.height.ceil().max(1.0) as u32;
        // 数据变化也会走到这里，尺寸没变时不要重设窗口，
        // 否则每次分发都会把物品栏重新提层，拖拽浮层闪一下
        if width != old_width || height != old_height {
            // SAFETY: 只调整自身窗口矩形，不激活
            unsafe {
                w::SetWindowPos(
                    state.hwnd,
                    w::HWND_TOPMOST,
                    x,
                    y,
                    width as i32,
                    height as i32,
                    w::SWP_NOACTIVATE,
                );
            }
        }
        state.rect = Some((x, y, width, height));
    }
    place_entity(state);
    sync_look_timer(state);
    push_drop_zones(state);
}

fn apply_geometry(state: &mut State) {
    let width = state.layout.width.ceil().max(1.0) as u32;
    let height = state.layout.height.ceil().max(1.0) as u32;

    let saved = if state.config.remember_position { state.config.position.clone() } else { None };
    let work = w::work_area(state.hwnd);
    let centered = || {
        (
            work.left + ((work.right - work.left) - width as i32) / 2,
            work.top + ((work.bottom - work.top) - height as i32) / 2,
        )
    };
    let (x, y) = match saved {
        Some(point) => {
            let x = (point.x as f32 * state.dpi).round() as i32;
            let y = (point.y as f32 * state.dpi).round() as i32;
            let visible = x + width as i32 > work.left
                && x < work.right
                && y + height as i32 > work.top
                && y < work.bottom;
            if visible {
                clamp_to_work(x, y, width, height, work)
            } else {
                centered()
            }
        }
        None => centered(),
    };

    // SAFETY: 只调整自身窗口矩形，不激活
    unsafe {
        w::SetWindowPos(state.hwnd, w::HWND_TOPMOST, x, y, width as i32, height as i32, w::SWP_NOACTIVATE);
    }
    state.rect = Some((x, y, width, height));
}

fn clamp_to_work(x: i32, y: i32, width: u32, height: u32, work: w::Rect) -> (i32, i32) {
    let max_x = (work.right - width as i32).max(work.left);
    let max_y = (work.bottom - height as i32).max(work.top);
    (x.clamp(work.left, max_x), y.clamp(work.top, max_y))
}

fn push_drop_zones(state: &State) {
    let zones = state
        .layout
        .slots
        .iter()
        .map(|slot| crate::dragdrop::Zone {
            id: slot.id.clone(),
            left: slot.left as f64,
            top: slot.top as f64,
            width: slot.width as f64,
            height: slot.height as f64,
        })
        .collect();
    crate::dragdrop::set_zones("inventory", zones);
}

fn file_stamp(path: &str) -> u128 {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn icon_size(state: &State) -> u32 {
    (state.layout.slot_size.round() as f32).clamp(ICON_MIN, ICON_MAX) as u32
}

fn refresh_icons(state: &mut State) {
    let scope = state.config.scope();
    let size = icon_size(state);
    let show_target = false;
    let count = state.layout.slots.len();
    // 数据变化可能早于第一次配置推送，图标缓存按当前布局补齐
    if state.icons.len() != count {
        state.icons.resize(count, None);
    }
    if state.icon_keys.len() != count {
        state.icon_keys.resize(count, String::new());
    }

    for (index, slot) in state.layout.slots.iter().enumerate() {
        if state.drag_source == Some(index) {
            state.icons[index] = None;
            state.icon_keys[index].clear();
            continue;
        }
        let item = slots::get(&scope, &slot.id);
        let key = match &item {
            Some(item) => format!("{size}|{show_target}|{}|{}", file_stamp(&item.path), item.path),
            None => String::new(),
        };
        if state.icon_keys[index] == key {
            continue;
        }
        state.icon_keys[index] = key.clone();
        let Some(item) = item else {
            state.icons[index] = None;
            continue;
        };

        match crate::icons::cached(&item.path, show_target, size) {
            Some(entry) => state.icons[index] = icon_from(entry, size),
            None => {
                let app = state.app.clone();
                let path = item.path.clone();
                std::thread::spawn(move || {
                    let decoded = crate::icons::decoded(&path, show_target, size);
                    let app_for_install = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        install_icon(&app_for_install, &key, decoded, size);
                    });
                });
            }
        }
    }
}

fn icon_from(entry: Option<std::sync::Arc<crate::icons::Decoded>>, size: u32) -> Option<SlotIcon> {
    match entry {
        Some(decoded) => Some(SlotIcon { sprite: Rc::new(sprite::from_rgba(decoded.size, decoded.size, &decoded.pixels)) }),
        None => barrier_icon(size),
    }
}

fn barrier_icon(size: u32) -> Option<SlotIcon> {
    let raw = sprite::load("item/barrier.png")?;
    Some(SlotIcon { sprite: Rc::new(raw.resized(size, size, false)) })
}

fn install_icon(app: &AppHandle, key: &str, decoded: Option<std::sync::Arc<crate::icons::Decoded>>, size: u32) {
    let _ = app;
    with_state(|state| {
        for index in 0..state.icon_keys.len() {
            // 数据换了 key 就对不上；拖动源由拖出守卫负责
            if state.icon_keys[index] != key || state.drag_source == Some(index) {
                continue;
            }
            state.icons[index] = icon_from(decoded.clone(), size);
        }
        render(state);
    });
}

/// 离屏窗口就绪：登记句柄、设为穿透覆盖层，并补发当前预览参数
pub fn entity_ready() {
    with_state(|state| {
        use tauri::Manager;

        let window = state.app.get_webview_window("entity-view");
        state.entity_hwnd = window
            .as_ref()
            .and_then(|window| window.hwnd().ok())
            .map(|hwnd| hwnd.0 as isize)
            .unwrap_or(0);
        if state.entity_hwnd != 0 {
            w::set_overlay_style(state.entity_hwnd);
        }
        state.entity_meta = None;
        sync_entity_setup(state);
        place_entity(state);
        // 页面挂载完成后再显示，位置由 place_entity 决定，不抢物品栏焦点
        if state.entity_hwnd != 0 {
            // SAFETY: 只显示自己创建的覆盖层窗口
            unsafe {
                w::ShowWindow(state.entity_hwnd, w::SW_SHOWNOACTIVATE);
            }
        }
    });
}

/// 3D 覆盖层贴住玩家区域；不可见或当前容器没有玩家区域时移出屏幕。
fn place_entity(state: &mut State) {
    if state.entity_hwnd == 0 {
        return;
    }
    let target = if state.visible && state.config.show_model {
        state.rect.zip(state.layout.player.as_ref()).map(|((x, y, _, _), player)| {
            (
                x + player.left.round() as i32,
                y + player.top.round() as i32,
                player.width.round().max(1.0) as i32,
                player.height.round().max(1.0) as i32,
            )
        })
    } else {
        None
    };
    let Some((left, top, width, height)) = target else {
        // SAFETY: 只移动自身窗口
        unsafe {
            w::SetWindowPos(
                state.entity_hwnd,
                0,
                -32000,
                -32000,
                0,
                0,
                w::SWP_NOSIZE | w::SWP_NOZORDER | w::SWP_NOACTIVATE,
            );
        }
        return;
    };
    // SAFETY: 提到置顶带最前，保证盖在物品栏之上，且不抢焦点
    unsafe {
        w::SetWindowPos(
            state.entity_hwnd,
            w::HWND_TOPMOST,
            left,
            top,
            width,
            height,
            w::SWP_NOACTIVATE,
        );
    }
}

/// 外部拖放结束后由 dragdrop 调用，延迟把键盘焦点收回物品栏。
pub fn focus_after_drop(hwnd: w::Hwnd) {
    w::post_message(hwnd, WM_DROP_FOCUS, 0, 0);
}

/// 拖放回调内立即尝试收回焦点，此时进程通常仍有前台权限。
pub fn focus_now(hwnd: w::Hwnd) {
    w::focus_window(hwnd);
}

/// 玩家预览尺寸或皮肤变化时下发一次重建
fn sync_entity_setup(state: &mut State) {
    if state.layout.player.is_none() || !state.config.show_model {
        // 当前容器没有玩家区域或已关闭 3D 模型，覆盖层留在屏幕外并停止渲染
        state.entity_meta = None;
        let _ = state.app.emit_to("entity-view", "entity-active", serde_json::json!({ "visible": false }));
        return;
    }
    let cfg = &state.config.player;
    let key = format!("{}|{}|{}", cfg.skin_name, cfg.skin_type, cfg.skin_path);
    if state.entity_meta.as_deref() == Some(key.as_str()) {
        return;
    }
    state.entity_meta = Some(key);
    let payload = serde_json::json!({
        "skin": if cfg.skin_name.is_empty() { "steve" } else { cfg.skin_name.as_str() },
        "skinType": if cfg.skin_type.is_empty() { "wide" } else { cfg.skin_type.as_str() },
        "skinPath": cfg.skin_path,
    });
    let _ = state.app.emit_to("entity-view", "entity-setup", payload);
    let visible = state.visible && state.layout.player.is_some();
    let _ = state.app.emit_to("entity-view", "entity-active", serde_json::json!({ "visible": visible }));
}

/// 换算头身跟随角度
fn sync_entity_look(state: &mut State, x: f32, y: f32) {
    if !state.visible {
        return;
    }
    let Some(player) = &state.layout.player else { return };
    let Some((rx, ry, _, _)) = state.rect else { return };
    let unit = state.unit.max(0.001);
    let margin = 6.0 * unit;
    let display = (player.height - 12.0 * unit).max(1.0);
    let neck_x = rx as f32 + player.left + player.width / 2.0;
    let neck_y = ry as f32 + player.top + player.height - margin + display * (24.0 / 32.0);
    let cursor_x = rx as f32 + x;
    let cursor_y = ry as f32 + y;
    let work = w::work_area(state.hwnd);
    let max_x = (neck_x - work.left as f32).max(work.right as f32 - neck_x).max(1.0);
    let max_y = (neck_y - work.top as f32).max(work.bottom as f32 - neck_y).max(1.0);
    let ratio_x = ((cursor_x - neck_x) / max_x).clamp(-1.0, 1.0);
    let ratio_y = ((cursor_y - neck_y) / max_y).clamp(-1.0, 1.0);
    let payload = serde_json::json!({
        "bodyYaw": ratio_x * 45.0,
        // 模型正面朝 +z：绕 X 轴正角度低头，光标在下方时 ratio_y 为正
        "bodyPitch": ratio_y * 10.0,
        "headPitch": ratio_y * 10.0,
    });
    let _ = state.app.emit_to("entity-view", "entity-look", payload);
}

/// 读取全局光标位置并更新跟随角度，覆盖物品栏以外的屏幕区域。
fn track_cursor(state: &mut State) {
    let cursor = w::cursor_pos();
    let anchor = state.rect.map(|(x, y, _, _)| (cursor.x, cursor.y, x, y));
    if state.look_cursor == anchor {
        return;
    }
    let point = w::to_client(state.hwnd, cursor);
    sync_entity_look(state, point.x as f32, point.y as f32);
    state.look_cursor = anchor;
}

/// 物品栏可见、开启 3D 模型且当前容器有玩家区域时，按刷新率轮询光标。
fn sync_look_timer(state: &mut State) {
    let wanted = state.visible && state.config.show_model && state.layout.player.is_some();
    if wanted == state.look_timer {
        return;
    }
    state.look_timer = wanted;
    // SAFETY: 定时器只绑定自身窗口
    unsafe {
        if wanted {
            w::SetTimer(state.hwnd, TIMER_LOOK, LOOK_INTERVAL_MS as u32, 0);
        } else {
            w::KillTimer(state.hwnd, TIMER_LOOK);
        }
    }
    if wanted {
        state.look_cursor = None;
        track_cursor(state);
    }
}

/// 数据变化后刷新图标与画面。
pub fn slots_changed() {
    with_state(|state| {
        // 窗口隐藏时不装载图标，显示时再按当前数据补齐
        if !state.visible {
            return;
        }
        refresh_icons(state);
        refresh_tooltip(state);
        render(state);
    });
}

/// 外部文件拖入悬停，只影响蒙版显示。
pub fn set_drop_hover(zone: Option<&str>) {
    with_state(|state| {
        let next = match zone {
            Some(id) if state.config.hover_effect => inventory_draw::slot_index(&state.layout, id),
            _ => None,
        };
        if state.drop_hover != next {
            state.drop_hover = next;
            hide_tooltip(state);
            render(state);
        }
    });
}

/// 扫格期间高亮按当前真实光标取格，不使用排队中的采样坐标。
fn live_hover(state: &State) -> Option<usize> {
    let cursor = w::cursor_pos();
    let point = w::to_client(state.hwnd, cursor);
    inventory_draw::slot_at(&state.layout, point.x as f32, point.y as f32)
}

fn render(state: &mut State) {
    let width = state.layout.width.ceil().max(1.0) as u32;
    let height = state.layout.height.ceil().max(1.0) as u32;
    if state.frame.as_ref().map(|frame| frame.width != width || frame.height != height).unwrap_or(true) {
        state.frame = Some(Frame::new(width, height));
    }
    if state.dib.as_ref().map(|dib| dib.width != width || dib.height != height).unwrap_or(true) {
        state.dib = Dib::new(width, height);
    }
    let dimmed = state
        .config
        .cut_slot
        .as_deref()
        .and_then(|id| inventory_draw::slot_index(&state.layout, id));
    let hover_slot = if state.shift_sweeping && state.left_down {
        live_hover(state)
    } else {
        state.hover
    };
    let hover = state.drop_hover.or(hover_slot);
    let hover_green = state.drop_hover.is_none()
        && hover_slot
            .filter(|index| Some(*index) == state.hover)
            .map(|index| hover_green(state, index))
            .unwrap_or(false);

    let model = inventory_draw::Model {
        layout: &state.layout,
        background: &state.background,
        icons: &state.icons,
        hover,
        hover_green,
        show_player: state.config.show_model,
        drag_source: if state.distribute.is_some() {
            None
        } else {
            state.drag.as_ref().map(|drag| drag.source).or(state.drag_source)
        },
        dimmed,
    };

    let Some(frame) = &mut state.frame else { return };
    inventory_draw::draw(frame, &model);
    present(state);
}

fn present(state: &mut State) {
    if let (Some(drag), Some(origin)) = (&state.drag, state.rect) {
        if let Some(Some(icon)) = state.icons.get(drag.source) {
            dragicon::show(
                "inventory",
                &icon.sprite,
                origin.0 + drag.x.round() as i32,
                origin.1 + drag.y.round() as i32,
            );
        }
    } else if state.drag_source.is_none() {
        dragicon::hide("inventory");
    }

    if let (Some(dib), Some((x, y, _, _)), Some(frame)) = (&state.dib, state.rect, &state.frame) {
        w::present(state.hwnd, frame, dib, x, y);
    }

    if state.visible && !state.shown {
        state.shown = true;
        // SAFETY: 只显示窗口
        unsafe {
            w::ShowWindow(state.hwnd, w::SW_SHOWNOACTIVATE);
        }
    }
}

fn hover_green(state: &State, index: usize) -> bool {
    slots::get(&state.config.scope(), &state.layout.slots[index].id).is_some()
        && w::ticks().saturating_sub(state.hover_at) >= HOVER_GREEN_MS
}

pub fn set_visible_inner(state: &mut State) {
    let visible = state.config.visible;
    state.visible = visible;
    let show_model = state.config.show_model;
    if visible && show_model {
        // 控制页按需创建 3D 覆盖层，未打开物品栏或关闭模型时不占渲染进程
        let _ = state.app.emit("entity-view-warm", ());
    }
    let active = visible && show_model && state.layout.player.is_some();
    let _ = state.app.emit_to("entity-view", "entity-active", serde_json::json!({ "visible": active }));

    crate::hud::overlay::set_visible(visible && state.config.gray_overlay, state.config.gray_overlay_opacity);

    if visible {
        if state.config.hide_status_bar && !crate::hud::hidden_by_inventory() {
            state.hidden_status_bar = true;
            crate::hud::set_hidden_by_inventory(true);
        }
        refresh_icons(state);
        render(state);
        if state.shown {
            // SAFETY: 蒙版先显示，物品栏再提到最前，并拿到键盘焦点处理 E/ESC/Q
            w::raise_overlay(state.hwnd);
            unsafe {
                w::SetForegroundWindow(state.hwnd);
            }
        }
    } else {
        if state.hidden_status_bar {
            state.hidden_status_bar = false;
            crate::hud::set_hidden_by_inventory(false);
        }
        hide_tooltip(state);
        stop_shift_sampler();
        state.tracked = false;
        state.press = None;
        state.drag = None;
        state.distribute = None;
        state.shift_sweeping = false;
        state.last_shift_slot = None;
        state.hover = None;
        state.drop_hover = None;
        state.q_down = false;
        state.last_move = None;
        if let Ok(mut sequence) = KEY_SEQUENCE.lock() {
            sequence.reset();
        }
        if state.shown {
            state.shown = false;
            // SAFETY: 只隐藏窗口
            unsafe {
                w::ShowWindow(state.hwnd, w::SW_HIDE);
            }
        }
        dragicon::hide("inventory");
    }
    place_entity(state);
    sync_look_timer(state);
}

/// 物品栏当前是否可见，供托盘菜单生成动态文案。
pub fn is_visible() -> bool {
    with_state(|state| state.visible).unwrap_or(false)
}

pub fn set_visible(visible: bool) {
    with_state(|state| {
        if state.config.visible == visible {
            return;
        }
        state.config.visible = visible;
        // 配置尚未到达时只记下目标状态，第一份配置会按它显示
        if !state.configured {
            return;
        }
        set_visible_inner(state);
    });
}

/// 收起物品栏并把可见性交回配置层持久化。
pub fn request_close(state: &mut State) {
    state.config.visible = false;
    set_visible_inner(state);
    let _ = state.app.emit("inventory-visibility", false);
}

fn hide_tooltip(state: &mut State) {
    if state.tooltip_slot.take().is_some() {
        tooltip::hide();
    }
}

fn refresh_tooltip(state: &mut State) {
    let Some(index) = state.tooltip_slot else { return };
    let slot = &state.layout.slots[index];
    if !state.config.show_tooltip {
        hide_tooltip(state);
        return;
    }
    let Some(item) = slots::get(&state.config.scope(), &slot.id) else {
        hide_tooltip(state);
        return;
    };
    show_tooltip(state, index, &item);
}

const COLOR_ORIGINAL_NAME: u32 = 0xfffc_fc54;
const COLOR_FILE_PATH: u32 = 0xffa8_a8a8;
const COLOR_FILE_TYPE: u32 = 0xff54_54fc;
const COLOR_FILE_MISSING: u32 = 0xfffc_5454;

fn file_stem(name: &str) -> &str {
    match name.rfind('.') {
        Some(index) if index > 0 => &name[..index],
        _ => name,
    }
}

fn file_extension(name: &str) -> &str {
    match name.rfind('.') {
        Some(index) if index > 0 => &name[index..],
        _ => "",
    }
}

fn tooltip_lines(state: &State, item: &SlotItem) -> Vec<tooltip::TooltipLine> {
    let name = slots::display_name(item);
    if slots::is_missing(&item.path) {
        return vec![
            tooltip::TooltipLine { text: name, color: COLOR_ORIGINAL_NAME },
            tooltip::TooltipLine { text: "文件已丢失".into(), color: COLOR_FILE_MISSING },
        ];
    }

    let color = |setting: &str, stem: &str| {
        if setting == "auto" {
            text::auto_color(stem)
        } else {
            text::parse_color(setting)
        }
    };
    let stem = file_stem(&name);
    let mut lines = Vec::new();
    if state.config.tooltip_show_file_name {
        lines.push(tooltip::TooltipLine { text: stem.to_string(), color: color(&state.config.file_name_color, stem) });
    }
    if state.config.tooltip_show_original_name {
        lines.push(tooltip::TooltipLine { text: name.clone(), color: COLOR_ORIGINAL_NAME });
    }
    if state.config.tooltip_show_file_path {
        lines.push(tooltip::TooltipLine { text: item.path.clone(), color: COLOR_FILE_PATH });
    }
    if state.config.tooltip_show_file_type {
        let extension = file_extension(&name);
        lines.push(tooltip::TooltipLine {
            text: if extension.is_empty() { "(无后缀)".to_string() } else { extension.to_string() },
            color: COLOR_FILE_TYPE,
        });
    }
    if lines.is_empty() {
        lines.push(tooltip::TooltipLine { text: stem.to_string(), color: color(&state.config.file_name_color, stem) });
    }
    lines
}

fn show_tooltip(state: &mut State, index: usize, item: &SlotItem) {
    if !state.config.show_tooltip {
        return;
    }
    let Some((x, y, _, _)) = state.rect else { return };
    let slot = &state.layout.slots[index];
    let anchor = tooltip::RectF {
        left: x as f32 + slot.left,
        top: y as f32 + slot.top,
        right: x as f32 + slot.left + slot.width,
        bottom: y as f32 + slot.top + slot.height,
    };
    let work = w::work_area(state.hwnd);
    let work = tooltip::RectF {
        left: work.left as f32,
        top: work.top as f32,
        right: work.right as f32,
        bottom: work.bottom as f32,
    };
    let lines = tooltip_lines(state, item);
    tooltip::show(&lines, state.unit, &anchor, &work);
}

fn sync_tooltip(state: &mut State, hover: Option<usize>) {
    if hover == state.tooltip_slot {
        return;
    }
    state.tooltip_slot = hover;
    match hover {
        Some(index) => {
            if state.config.show_tooltip {
                if let Some(item) = slots::get(&state.config.scope(), &state.layout.slots[index].id) {
                    show_tooltip(state, index, &item);
                }
            }
        }
        None => tooltip::hide(),
    }
}

fn point_of(lparam: isize) -> (f32, f32) {
    let x = (lparam & 0xffff) as i16 as f32;
    let y = ((lparam >> 16) & 0xffff) as i16 as f32;
    (x, y)
}

/// 上一位置到当前位置之间的采样点：系统会合并鼠标移动消息，
/// 只处理落点会跳过快速划过的一两个格子。
fn sweep_points(previous: Option<(f32, f32)>, x: f32, y: f32, step: f32) -> Vec<(f32, f32)> {
    let Some((from_x, from_y)) = previous else {
        return vec![(x, y)];
    };
    let dx = x - from_x;
    let dy = y - from_y;
    let distance = (dx * dx + dy * dy).sqrt();
    if distance <= step {
        return vec![(x, y)];
    }
    let count = ((distance / step).ceil() as usize).min(SWEEP_MAX_POINTS);
    let mut points = Vec::with_capacity(count);
    for index in 1..=count {
        let t = index as f32 / count as f32;
        points.push((from_x + dx * t, from_y + dy * t));
    }
    points
}

fn outside(state: &State, x: f32, y: f32) -> bool {
    let (left, top, right, bottom) = state.layout.bounds;
    // 原版是 4 个界面像素，与格子缩放无关
    let margin = OUTSIDE_MARGIN * state.dpi;
    x < left - margin || y < top - margin || x > right + margin || y > bottom + margin
}

fn persist_position(state: &State) {
    if !state.config.remember_position {
        return;
    }
    let Some((x, y, _, _)) = state.rect else { return };
    let _ = state.app.emit(
        "inventory-moved",
        serde_json::json!({
            "x": (x as f32 / state.dpi).round() as i32,
            "y": (y as f32 / state.dpi).round() as i32,
        }),
    );
}

/// 按住丢弃键扫过路径上的格子，一帧内经过的格子合并成一次提交。
fn drop_path(state: &mut State, previous: Option<(f32, f32)>, x: f32, y: f32) -> bool {
    if !state.q_down {
        return false;
    }
    let scope = state.config.scope();
    let mut ids = Vec::new();
    for (point_x, point_y) in sweep_points(previous, x, y, state.unit * SWEEP_STEP) {
        let Some(index) = inventory_draw::slot_at(&state.layout, point_x, point_y) else { continue };
        if state.last_dropped == Some(index) {
            continue;
        }
        state.last_dropped = Some(index);
        let id = state.layout.slots[index].id.clone();
        if slots::get(&scope, &id).is_some() {
            ids.push(id);
        }
    }
    if ids.is_empty() {
        return false;
    }
    let hover_dropped = state
        .hover
        .map(|index| ids.contains(&state.layout.slots[index].id))
        .unwrap_or(false);
    slots::clear_many(&scope, ids);
    if hover_dropped {
        hide_tooltip(state);
    }
    refresh_icons(state);
    true
}

fn update_hover(state: &mut State, hover: Option<usize>, force_render: bool) {
    let changed = hover != state.hover;
    if changed {
        state.hover = hover;
        state.hover_at = w::ticks();
    }
    sync_tooltip(state, hover);
    if state.config.hover_effect && hover.is_some() {
        // SAFETY: 只安排自身定时器
        unsafe {
            w::SetTimer(state.hwnd, TIMER_HOVER, HOVER_GREEN_MS as u32, 0);
        }
    }
    if changed || force_render {
        render(state);
    }
}

fn begin_drag(state: &mut State, x: f32, y: f32) {
    let Some(press) = state.press.take() else { return };
    state.drag = Some(Drag { source: press.slot, target: press.slot, x, y });
    state.hover = None;
    hide_tooltip(state);
    render(state);
}

/// 拖出交接：先把图标从格子里拿掉并清掉 key，系统拖放期间该格不再刷新。
fn prepare_drag_out(state: &mut State) -> Option<(String, u32, String)> {
    let drag = state.drag.take()?;
    state.press = None;
    state.hover = None;
    sync_tooltip(state, None);

    let scope = state.config.scope();
    let slot = state.layout.slots[drag.source].id.clone();
    let Some(item) = slots::get(&scope, &slot) else {
        render(state);
        return None;
    };
    if slots::is_missing(&item.path) {
        render(state);
        return None;
    }

    let hidden = state.icons.get(drag.source).cloned().unwrap_or(None);
    let hidden_key = if drag.source < state.icon_keys.len() {
        std::mem::take(&mut state.icon_keys[drag.source])
    } else {
        String::new()
    };
    if drag.source < state.icons.len() {
        state.icons[drag.source] = None;
    }
    state.hidden_icon = Some((hidden, hidden_key));
    state.drag_source = Some(drag.source);
    dragicon::hide("inventory");
    render(state);

    let size = icon_size(state);
    Some((item.path, size, slot))
}

fn finish_drag_out(state: &mut State, source: usize, result: crate::dragdrop::DragResult) {
    state.drag_source = None;
    if result.dropped && !result.same_source {
        // 落在本应用的格子上时数据已经由 Rust 一次搬走；
        // 落到桌面或资源管理器时只清空格子
        if !result.handled {
            let scope = state.config.scope();
            let id = state.layout.slots[source].id.clone();
            slots::clear(&scope, &id);
        }
        state.hidden_icon = None;
        refresh_icons(state);
        render(state);
        return;
    }

    if let Some((hidden, key)) = state.hidden_icon.take() {
        if source < state.icons.len() {
            state.icons[source] = hidden;
        }
        if source < state.icon_keys.len() {
            state.icon_keys[source] = key;
        }
    }
    refresh_icons(state);
    render(state);
}

/// 系统拖放会阻塞消息循环，只在 State 未被借用时调用。
/// 阻塞期间本窗口仍能收到其它窗口发起的拖入悬停与落点。
fn start_system_drag() {
    let Some((Some(job), Some(source))) = with_state(|state| {
        let source = state.drag.as_ref().map(|drag| drag.source);
        let job = prepare_drag_out(state);
        (job, source)
    }) else {
        return;
    };

    let (path, size, slot) = job;
    let result = crate::dragdrop::begin_file_drag(path, size, Some(("inventory".to_string(), slot)));
    with_state(|state| finish_drag_out(state, source, result));
}

fn distribute_to(state: &mut State, index: usize, path: &str) -> bool {
    let scope = state.config.scope();
    let id = state.layout.slots[index].id.clone();
    if slots::get(&scope, &id).is_some() {
        return false;
    }
    slots::set(&scope, &id, SlotItem { path: path.to_string(), display_name: None });
    true
}

fn begin_distribute(state: &mut State, x: f32, y: f32) {
    if state.drag.is_some() || state.distribute.is_some() {
        return;
    }
    let Some(index) = inventory_draw::slot_at(&state.layout, x, y) else { return };
    let scope = state.config.scope();
    let id = state.layout.slots[index].id.clone();
    let Some(item) = slots::get(&scope, &id) else { return };

    state.press = None;
    state.distribute = Some(Distribute { source: index, path: item.path, last: None });
    state.hover = None;
    state.drag = Some(Drag { source: index, target: index, x, y });
    state.last_move = None;
    hide_tooltip(state);
    render(state);
}

fn place_distribute(state: &mut State, x: f32, y: f32) {
    let Some(source) = state.distribute.as_ref().map(|distribute| distribute.source) else { return };
    let Some(index) = inventory_draw::slot_at(&state.layout, x, y) else { return };
    if index == source {
        return;
    }
    let Some(path) = state.distribute.as_ref().map(|distribute| distribute.path.clone()) else { return };
    if distribute_to(state, index, &path) {
        refresh_icons(state);
    }
}

/// 沿上一位置到当前位置的路径落格，一帧内跨过的格子一并写入。
fn sweep_distribute(state: &mut State, previous: Option<(f32, f32)>, x: f32, y: f32) {
    if !state.left_down {
        return;
    }
    let Some((source, mut last, path)) = state
        .distribute
        .as_ref()
        .map(|distribute| (distribute.source, distribute.last, distribute.path.clone()))
    else {
        return;
    };

    let mut targets = Vec::new();
    for (point_x, point_y) in sweep_points(previous, x, y, state.unit * SWEEP_STEP) {
        let Some(index) = inventory_draw::slot_at(&state.layout, point_x, point_y) else { continue };
        if index == source || last == Some(index) {
            continue;
        }
        last = Some(index);
        targets.push(index);
    }
    if let Some(distribute) = &mut state.distribute {
        distribute.last = last;
    }
    if targets.is_empty() {
        return;
    }

    let scope = state.config.scope();
    let mut items = Vec::new();
    for index in targets {
        let id = state.layout.slots[index].id.clone();
        if slots::get(&scope, &id).is_none() {
            items.push((id, SlotItem { path: path.clone(), display_name: None }));
        }
    }
    if !items.is_empty() {
        slots::set_many(&scope, items);
        refresh_icons(state);
    }
}

fn end_distribute(state: &mut State) {
    state.distribute = None;
    state.drag = None;
    render(state);
}

fn find_first_empty(state: &State, category: &str) -> Option<String> {
    let scope = state.config.scope();
    let ids: Vec<String> = if category == "hotbar" {
        (0..9).map(|index| format!("hotbar_{index}")).collect()
    } else {
        (0..27).map(|index| format!("inventory_{index}")).collect()
    };
    ids.into_iter().find(|id| slots::get(&scope, id).is_none())
}

fn shift_move(state: &mut State, index: usize) -> bool {
    let scope = state.config.scope();
    let id = state.layout.slots[index].id.clone();
    if slots::get(&scope, &id).is_none() {
        return false;
    }

    let category = if id.starts_with("hotbar_") {
        "hotbar"
    } else if id.starts_with("inventory_") {
        "inventory"
    } else if matches!(id.as_str(), "helmet" | "chestplate" | "leggings" | "boots") {
        "armor"
    } else if id.starts_with("craft_") || id == "craft_result" {
        "craft"
    } else if id == "offhand" {
        "offhand"
    } else {
        return false;
    };

    let target_category = if category == "inventory" { "hotbar" } else { "inventory" };
    let Some(target) = find_first_empty(state, target_category) else { return false };
    slots::move_to(&scope, &id, &target)
}

/// 进入新格子立即搬移；采样和鼠标消息共用这一个入口。
fn shift_step(state: &mut State, x: f32, y: f32) {
    // 高亮先按实时光标刷新，再处理搬移，避免写盘和广播拖慢悬停
    update_hover(state, live_hover(state), false);

    let current = inventory_draw::slot_at(&state.layout, x, y);
    let mut moved = false;
    if let Some(index) = current {
        if state.last_shift_slot != Some(index) {
            state.last_shift_slot = Some(index);
            moved = shift_move(state, index);
            if moved {
                refresh_icons(state);
            }
        }
    }
    if moved {
        render(state);
    }
}

fn click_slot(state: &mut State, index: usize) {
    let scope = state.config.scope();
    let id = state.layout.slots[index].id.clone();
    if slots::get(&scope, &id).is_none() {
        return;
    }
    if state.config.click_mode == "single" {
        let _ = state.app.emit("inventory-open", &id);
        return;
    }
    let now = w::ticks();
    let double = state.last_click_slot == Some(index) && now.saturating_sub(state.last_click_at) < DOUBLE_CLICK_MS;
    if double {
        state.last_click_slot = None;
        state.last_click_at = 0;
        let _ = state.app.emit("inventory-open", &id);
    } else {
        state.last_click_slot = Some(index);
        state.last_click_at = now;
    }
}

fn handle_input(message: u32, wparam: usize, lparam: isize) -> Option<isize> {
    match message {
        // 系统键只跟踪序列，继续交给默认处理，不吞掉 Alt 组合
        w::WM_SYSKEYDOWN | w::WM_SYSKEYUP => {
            with_state(|state| handle_message(state, message, wparam, lparam));
            None
        }
        w::WM_MOUSEMOVE | w::WM_LBUTTONDOWN | w::WM_LBUTTONUP | w::WM_MBUTTONDOWN | w::WM_RBUTTONUP
        | w::WM_KEYDOWN | w::WM_KEYUP | w::WM_MOUSELEAVE | w::WM_CAPTURECHANGED | w::WM_TIMER
        | WM_SHIFT_SAMPLE => {
            let drag_out = with_state(|state| handle_message(state, message, wparam, lparam)).unwrap_or(false);
            if drag_out {
                start_system_drag();
            }
            Some(0)
        }
        _ => None,
    }
}

fn handle_message(state: &mut State, message: u32, wparam: usize, lparam: isize) -> bool {
    match message {
        w::WM_MOUSEMOVE => return on_move(state, lparam),
        w::WM_LBUTTONDOWN => on_left_down(state, wparam, lparam),
        w::WM_LBUTTONUP => on_left_up(state, lparam),
        w::WM_MBUTTONDOWN => on_middle_down(state, lparam),
        w::WM_RBUTTONUP => on_right_up(state, lparam),
        WM_SHIFT_SAMPLE => {
            if state.shift_sweeping && state.left_down {
                let (x, y) = point_of(lparam);
                shift_step(state, x, y);
            }
        }
        w::WM_MOUSELEAVE => {
            state.tracked = false;
            state.hover = None;
            state.press = None;
            state.last_move = None;
            sync_tooltip(state, None);
            render(state);
        }
        w::WM_KEYDOWN | w::WM_SYSKEYDOWN => on_key(state, crate::hotkeys::key_from_message(wparam, lparam)),
        w::WM_KEYUP | w::WM_SYSKEYUP => on_key_up(state, crate::hotkeys::key_from_message(wparam, lparam)),
        w::WM_CAPTURECHANGED => {
            state.press = None;
            state.last_move = None;
            state.shift_sweeping = false;
            state.last_shift_slot = None;
            stop_shift_sampler();
            if state.moving.take().is_some() {
                persist_position(state);
            }
            if state.drag.take().is_some() || state.distribute.take().is_some() {
                state.shift_sweeping = false;
                render(state);
            }
        }
        w::WM_TIMER => {
            if wparam == TIMER_LOOK {
                track_cursor(state);
            } else if wparam == TIMER_HOVER {
                // SAFETY: 只停自身定时器
                unsafe {
                    w::KillTimer(state.hwnd, TIMER_HOVER);
                }
                render(state);
            }
        }
        _ => {}
    }
    false
}

fn on_move(state: &mut State, lparam: isize) -> bool {
    let (x, y) = point_of(lparam);
    let previous = state.last_move.replace((x, y));

    if !state.tracked {
        state.tracked = true;
        w::track_leave(state.hwnd);
    }
    if let Some((rx, ry, _, _)) = state.rect {
        let anchor = (rx + x.round() as i32, ry + y.round() as i32, rx, ry);
        if state.look_cursor != Some(anchor) {
            sync_entity_look(state, x, y);
            state.look_cursor = Some(anchor);
        }
    }

    if state.moving.is_some() {
        if let Some(moving) = &state.moving {
            let cursor = w::cursor_pos();
            let nx = moving.origin.0 + cursor.x - moving.cursor.x;
            let ny = moving.origin.1 + cursor.y - moving.cursor.y;
            if let Some((_, _, width, height)) = state.rect {
                state.rect = Some((nx, ny, width, height));
            }
            // 内容未变，只把分层表面移到新位置；不重排层级，避免模型闪烁
            if let Some(dib) = &state.dib {
                w::update_layered(state.hwnd, dib, nx, ny);
            } else {
                render(state);
            }
            place_entity(state);
        }
        // 窗口移动后客户区坐标整体变化，后续不能按旧位置插值
        state.last_move = None;
        return false;
    }

    if state.distribute.is_some() {
        if let Some(drag) = &mut state.drag {
            drag.x = x;
            drag.y = y;
        }
        sweep_distribute(state, previous, x, y);
        render(state);
        return false;
    }

    if state.drag.is_some() {
        if outside(state, x, y) {
            return true;
        }
        if let Some(drag) = &mut state.drag {
            drag.x = x;
            drag.y = y;
            drag.target = inventory_draw::slot_at(&state.layout, x, y).unwrap_or(drag.source);
        }
        render(state);
        return false;
    }

    if state.shift_sweeping {
        if state.left_down {
            shift_step(state, x, y);
        }
        return false;
    }

    if let Some(press) = &state.press {
        let distance = ((x - press.x).powi(2) + (y - press.y).powi(2)).sqrt();
        let ready = w::ticks().saturating_sub(press.at) >= LONG_PRESS_MS;
        if ready && distance > DRAG_THRESHOLD {
            begin_drag(state, x, y);
        }
        return false;
    }

    let dropped = drop_path(state, previous, x, y);
    update_hover(state, inventory_draw::slot_at(&state.layout, x, y), dropped);
    false
}

fn on_left_down(state: &mut State, wparam: usize, lparam: isize) {
    let (x, y) = point_of(lparam);
    state.left_down = true;
    state.last_move = Some((x, y));
    stop_shift_sampler();
    // SAFETY: 捕获鼠标，拖出窗口后仍能收到移动
    unsafe {
        w::SetCapture(state.hwnd);
    }
    // SAFETY: 需要键盘焦点处理 E/ESC/Q，不影响置顶层级
    unsafe {
        w::SetForegroundWindow(state.hwnd);
    }

    if state.distribute.is_some() {
        return;
    }

    let Some(index) = inventory_draw::slot_at(&state.layout, x, y) else {
        state.hover = None;
        sync_tooltip(state, None);
        if !state.config.locked {
            if let Some((wx, wy, _, _)) = state.rect {
                state.moving = Some(WindowMove { cursor: w::cursor_pos(), origin: (wx, wy) });
            }
        }
        render(state);
        return;
    };

    if wparam & 0x0004 != 0 {
        state.shift_sweeping = true;
        state.last_shift_slot = Some(index);
        if shift_move(state, index) {
            refresh_icons(state);
            render(state);
        }
        start_shift_sampler();
        return;
    }

    state.press = Some(Press { slot: index, x, y, at: w::ticks() });
}

fn on_left_up(state: &mut State, lparam: isize) {
    state.left_down = false;
    stop_shift_sampler();
    // SAFETY: 释放鼠标捕获
    unsafe {
        w::ReleaseCapture();
    }
    let (x, y) = point_of(lparam);

    if state.moving.is_some() {
        state.moving = None;
        persist_position(state);
        return;
    }

    if state.distribute.is_some() {
        place_distribute(state, x, y);
        end_distribute(state);
        update_hover(state, inventory_draw::slot_at(&state.layout, x, y), false);
        return;
    }

    if state.shift_sweeping {
        state.shift_sweeping = false;
        state.last_shift_slot = None;
        return;
    }

    if let Some(drag) = state.drag.take() {
        if drag.target != drag.source {
            let scope = state.config.scope();
            let source = state.layout.slots[drag.source].id.clone();
            let target = state.layout.slots[drag.target].id.clone();
            slots::swap(&scope, &source, &target);
            refresh_icons(state);
        }
        state.press = None;
        render(state);
        update_hover(state, inventory_draw::slot_at(&state.layout, x, y), false);
        return;
    }

    let Some(press) = state.press.take() else { return };
    let distance = ((x - press.x).powi(2) + (y - press.y).powi(2)).sqrt();
    if distance <= DRAG_THRESHOLD {
        click_slot(state, press.slot);
    }
}

fn on_middle_down(state: &mut State, lparam: isize) {
    let (x, y) = point_of(lparam);
    stop_shift_sampler();
    begin_distribute(state, x, y);
    // SAFETY: 捕获鼠标，按住左键扫格
    unsafe {
        w::SetCapture(state.hwnd);
    }
}

fn on_right_up(state: &mut State, lparam: isize) {
    if state.distribute.is_some() || state.drag.is_some() {
        return;
    }
    let (x, y) = point_of(lparam);
    let Some(index) = inventory_draw::slot_at(&state.layout, x, y) else { return };
    let id = state.layout.slots[index].id.clone();
    let screen = w::to_screen(state.hwnd, w::Point { x: x as i32, y: y as i32 });
    hide_tooltip(state);
    // 菜单仍由现有 WebView 提供，这里只交出格子与屏幕坐标
    let _ = state.app.emit(
        "inventory-menu",
        serde_json::json!({ "slotId": id, "x": screen.x, "y": screen.y }),
    );
}

fn on_key_up(state: &mut State, key: u32) {
    let (released_all, tap, tap_overflow) = {
        let Ok(mut sequence) = KEY_SEQUENCE.lock() else { return };
        sequence.release(key);
        (sequence.is_empty(), sequence.tap().to_vec(), sequence.tap_overflow())
    };

    state.q_down = false;
    state.last_dropped = None;

    if !released_all {
        return;
    }

    // 物品栏聚焦时钩子让路，由窗口按当前绑定广播全局快捷键
    crate::hotkeys::dispatch(&tap, tap_overflow);

    if let Ok(mut sequence) = KEY_SEQUENCE.lock() {
        sequence.reset();
    }
}

fn on_key(state: &mut State, key: u32) {
    if key == 0x1b {
        request_close(state);
        return;
    }

    let drop_key = state.config.drop_key.clone();
    let open_key = state.config.open_inventory.clone();
    let Ok(mut sequence) = KEY_SEQUENCE.lock() else { return };
    sequence.press(key);

    // 一次按下只关闭一次，自动重复不反复切换
    if !sequence.fired() && sequence.matches(&open_key) {
        sequence.mark_fired();
        drop(sequence);
        request_close(state);
        return;
    }

    // 自动重复继续触发，实现按住连续丢弃
    let drop_match = sequence.matches(&drop_key);
    drop(sequence);

    if drop_match {
        state.q_down = true;
        state.last_dropped = None;
        if let Some(index) = state.hover {
            let scope = state.config.scope();
            let id = state.layout.slots[index].id.clone();
            if slots::get(&scope, &id).is_some() {
                slots::clear(&scope, &id);
                refresh_icons(state);
                hide_tooltip(state);
                render(state);
            }
        }
    }
}

unsafe extern "system" fn wndproc(hwnd: w::Hwnd, message: u32, wparam: usize, lparam: isize) -> isize {
    match message {
        w::WM_MOUSEACTIVATE => return w::MA_ACTIVATE,
        w::WM_ERASEBKGND => return 1,
        w::WM_PAINT => {
            w::validate(hwnd);
            return 0;
        }
        w::WM_NCHITTEST => return w::HTCLIENT,
        w::WM_DPICHANGED => {
            with_state(|state| {
                rebuild_layout(state, false);
                refresh_icons(state);
                render(state);
            });
            return 0;
        }
        WM_DROP_FOCUS => {
            // OLE 拖放结束后前台仍在资源管理器，这里收回键盘焦点
            with_state(|state| place_entity(state));
            w::focus_window(hwnd);
            return 0;
        }
        _ => {}
    }
    if let Some(result) = handle_input(message, wparam, lparam) {
        return result;
    }
    w::DefWindowProcW(hwnd, message, wparam, lparam)
}
