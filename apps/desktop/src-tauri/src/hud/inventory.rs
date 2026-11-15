//! 物品栏原生窗口：容器背景、格子图标、悬停蒙版、拖动与文件拖放。

use std::cell::RefCell;
use std::rc::Rc;

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
const LONG_PRESS_MS: u64 = 150;
const DRAG_THRESHOLD: f32 = 10.0;
const HOVER_GREEN_MS: u64 = 250;
const DOUBLE_CLICK_MS: u64 = 500;
const OUTSIDE_MARGIN: f32 = 4.0;
const ICON_MIN: f32 = 32.0;
const ICON_MAX: f32 = 128.0;

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
    pub show_tooltip: bool,
    pub tooltip_show_file_name: bool,
    pub tooltip_show_original_name: bool,
    pub tooltip_show_file_path: bool,
    pub tooltip_show_file_type: bool,
    pub file_name_color: String,
    pub cut_slot: Option<String>,
    pub drop_key: String,
    pub open_inventory: String,
}

impl Default for InventoryCfg {
    fn default() -> Self {
        InventoryCfg {
            visible: false,
            locked: true,
            remember_position: true,
            position: None,
            gray_overlay: true,
            gray_overlay_opacity: 75.0,
            hide_status_bar: false,
            click_mode: "single".into(),
            style: "inventory.png".into(),
            shared_data: true,
            hover_effect: true,
            show_tooltip: false,
            tooltip_show_file_name: true,
            tooltip_show_original_name: false,
            tooltip_show_file_path: false,
            tooltip_show_file_type: false,
            file_name_color: "#FCFCFC".into(),
            cut_slot: None,
            drop_key: "q".into(),
            open_inventory: "e".into(),
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
    last_click_slot: Option<usize>,
    last_click_at: u64,
    tooltip_slot: Option<usize>,
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
        last_click_slot: None,
        last_click_at: 0,
        tooltip_slot: None,
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
        state.config = config;
        state.configured = true;
        let scope = state.config.scope();
        slots::register_scope("inventory", &scope.style, scope.shared);
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
            state.last_click_slot = None;
        }
        let _ = shared_changed;
        rebuild_layout(state, style_changed || state.rect.is_none());
        if state.config.visible {
            refresh_icons(state);
        }
        if visible_changed || (state.visible && (overlay_changed || hide_changed)) {
            set_visible_inner(state);
        }
        refresh_tooltip(state);
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
    } else if let Some((x, y, _, _)) = state.rect {
        let width = state.layout.width.ceil().max(1.0) as u32;
        let height = state.layout.height.ceil().max(1.0) as u32;
        // SAFETY: 只调整自身窗口矩形，不激活
        unsafe {
            w::SetWindowPos(state.hwnd, w::HWND_TOPMOST, x, y, width as i32, height as i32, w::SWP_NOACTIVATE);
        }
        state.rect = Some((x, y, width, height));
    }
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
    let hover = state.drop_hover.or(state.hover);
    let hover_green = state.drop_hover.is_none()
        && state.hover.map(|index| hover_green(state, index)).unwrap_or(false);

    let Some(frame) = &mut state.frame else { return };

    let model = inventory_draw::Model {
        layout: &state.layout,
        background: &state.background,
        icons: &state.icons,
        hover,
        hover_green,
        drag_source: if state.distribute.is_some() {
            None
        } else {
            state.drag.as_ref().map(|drag| drag.source).or(state.drag_source)
        },
        dimmed,
    };
    inventory_draw::draw(frame, &model);

    if let (Some(drag), Some(origin)) = (&state.drag, state.rect) {
        if let Some(Some(icon)) = state.icons.get(drag.source) {
            dragicon::show(&icon.sprite, origin.0 + drag.x.round() as i32, origin.1 + drag.y.round() as i32);
        }
    } else if state.drag_source.is_none() {
        dragicon::hide();
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
        state.tracked = false;
        state.press = None;
        state.drag = None;
        state.distribute = None;
        state.shift_sweeping = false;
        state.hover = None;
        state.drop_hover = None;
        state.q_down = false;
        if state.shown {
            state.shown = false;
            // SAFETY: 只隐藏窗口
            unsafe {
                w::ShowWindow(state.hwnd, w::SW_HIDE);
            }
        }
        dragicon::hide();
    }
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

fn update_hover(state: &mut State, hover: Option<usize>) {
    let mut changed = hover != state.hover;
    if state.q_down {
        if let Some(index) = hover {
            if state.last_dropped != Some(index) {
                let id = state.layout.slots[index].id.clone();
                if slots::get(&state.config.scope(), &id).is_some() {
                    slots::clear(&state.config.scope(), &id);
                    refresh_icons(state);
                    changed = true;
                }
                state.last_dropped = Some(index);
            }
        }
    }

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
    if changed {
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
    dragicon::hide();
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

fn distribute_to(state: &mut State, index: usize, path: &str) {
    let scope = state.config.scope();
    let id = state.layout.slots[index].id.clone();
    if slots::get(&scope, &id).is_some() {
        return;
    }
    slots::set(&scope, &id, SlotItem { path: path.to_string(), display_name: None });
    refresh_icons(state);
    render(state);
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
    distribute_to(state, index, &path);
}

fn sweep_distribute(state: &mut State, x: f32, y: f32) {
    if !state.left_down {
        return;
    }
    let Some((source, last, path)) = state
        .distribute
        .as_ref()
        .map(|distribute| (distribute.source, distribute.last, distribute.path.clone()))
    else {
        return;
    };
    let Some(index) = inventory_draw::slot_at(&state.layout, x, y) else { return };
    if index == source || last == Some(index) {
        return;
    }
    distribute_to(state, index, &path);
    if let Some(distribute) = &mut state.distribute {
        distribute.last = Some(index);
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

fn shift_move(state: &mut State, index: usize) {
    let scope = state.config.scope();
    let id = state.layout.slots[index].id.clone();
    let Some(item) = slots::get(&scope, &id) else { return };

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
        return;
    };

    let target_category = if category == "inventory" { "hotbar" } else { "inventory" };
    let Some(target) = find_first_empty(state, target_category) else { return };
    slots::set(&scope, &target, item);
    slots::clear(&scope, &id);
    refresh_icons(state);
    render(state);
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
        w::WM_MOUSEMOVE | w::WM_LBUTTONDOWN | w::WM_LBUTTONUP | w::WM_MBUTTONDOWN | w::WM_RBUTTONUP
        | w::WM_KEYDOWN | w::WM_KEYUP | w::WM_MOUSELEAVE | w::WM_CAPTURECHANGED | w::WM_TIMER => {
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
        w::WM_MOUSELEAVE => {
            state.tracked = false;
            state.hover = None;
            state.press = None;
            sync_tooltip(state, None);
            render(state);
        }
        w::WM_KEYDOWN => on_key(state, wparam),
        w::WM_KEYUP => on_key_up(state, wparam),
        w::WM_CAPTURECHANGED => {
            state.press = None;
            if state.moving.take().is_some() {
                persist_position(state);
            }
            if state.drag.take().is_some() || state.distribute.take().is_some() {
                state.shift_sweeping = false;
                render(state);
            }
        }
        w::WM_TIMER => {
            if wparam == TIMER_HOVER {
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

    if !state.tracked {
        state.tracked = true;
        w::track_leave(state.hwnd);
    }

    if state.moving.is_some() {
        if let Some(moving) = &state.moving {
            let cursor = w::cursor_pos();
            let nx = moving.origin.0 + cursor.x - moving.cursor.x;
            let ny = moving.origin.1 + cursor.y - moving.cursor.y;
            // SAFETY: 只移动自身窗口
            unsafe {
                w::SetWindowPos(state.hwnd, w::HWND_TOPMOST, nx, ny, 0, 0, w::SWP_NOSIZE | w::SWP_NOACTIVATE);
            }
            if let Some((_, _, width, height)) = state.rect {
                state.rect = Some((nx, ny, width, height));
            }
            render(state);
        }
        return false;
    }

    if state.distribute.is_some() {
        if let Some(drag) = &mut state.drag {
            drag.x = x;
            drag.y = y;
        }
        sweep_distribute(state, x, y);
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
        sweep_distribute(state, x, y);
        render(state);
        return false;
    }

    if state.shift_sweeping {
        if state.left_down {
            if let Some(index) = inventory_draw::slot_at(&state.layout, x, y) {
                if state.last_shift_slot != Some(index) {
                    state.last_shift_slot = Some(index);
                    shift_move(state, index);
                }
            }
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

    update_hover(state, inventory_draw::slot_at(&state.layout, x, y));
    false
}

fn on_left_down(state: &mut State, wparam: usize, lparam: isize) {
    let (x, y) = point_of(lparam);
    state.left_down = true;
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
        shift_move(state, index);
        return;
    }

    state.press = Some(Press { slot: index, x, y, at: w::ticks() });
}

fn on_left_up(state: &mut State, lparam: isize) {
    state.left_down = false;
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
        update_hover(state, inventory_draw::slot_at(&state.layout, x, y));
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
        update_hover(state, inventory_draw::slot_at(&state.layout, x, y));
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

fn on_key_up(state: &mut State, wparam: usize) {
    let key = wparam as u8;
    let drop_key = state.config.drop_key.to_lowercase();
    if drop_key.len() == 1 && drop_key.as_bytes()[0].to_ascii_uppercase() == key {
        state.q_down = false;
        state.last_dropped = None;
    }
}

fn on_key(state: &mut State, wparam: usize) {
    // 带修饰键的组合交给全局热键，不在窗口内重复处理
    if w::key_down(0x11) || w::key_down(0x12) || w::key_down(0x5b) || w::key_down(0x5c) {
        return;
    }
    let key = wparam as u8;
    if key == 0x1b {
        request_close(state);
        return;
    }
    let open_key = state.config.open_inventory.to_lowercase();
    if open_key.len() == 1 && open_key.as_bytes()[0].to_ascii_uppercase() == key {
        request_close(state);
        return;
    }
    let drop_key = state.config.drop_key.to_lowercase();
    if drop_key.len() == 1 && drop_key.as_bytes()[0].to_ascii_uppercase() == key {
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
        _ => {}
    }
    if let Some(result) = handle_input(message, wparam, lparam) {
        return result;
    }
    w::DefWindowProcW(hwnd, message, wparam, lparam)
}
