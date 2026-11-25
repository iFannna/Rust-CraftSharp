//! 原生状态栏窗口：布局、绘制与窗口几何在同一次提交里完成。

#![allow(non_snake_case)]

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::hud::config::{HudConfig, Metrics};
use crate::hud::draw::{self, FrameStyle, Overlay, SlotIcon};
use crate::hud::host::{self, Event, Host, Point};
use crate::hud::input;
use crate::hud::layout::{self, Layout};
use crate::hud::sprite::{self, Frame};
use crate::hud::text;
use crate::hud::dragicon;

const TIMER_ANIM: usize = 2;

pub struct Press {
    pub slot: i32,
    pub x: f32,
    pub y: f32,
    pub at: u64,
}

pub struct Drag {
    pub source: i32,
    pub target: i32,
    pub x: f32,
    pub y: f32,
}

/// 按住空白区域拖动整个状态栏
pub struct Move {
    pub cursor: Point,
    pub origin: (i32, i32),
}

pub struct Label {
    pub text: String,
    pub color: u32,
    pub shown_at: u64,
}

pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub height: u32,
    pub core_left: f32,
}

pub struct State {
    pub app: AppHandle,
    pub host: Host,
    pub config: Option<HudConfig>,
    pub style: Option<FrameStyle>,
    pub icons: Vec<Option<SlotIcon>>,
    pub missing: Vec<bool>,
    pub icon_keys: Vec<String>,
    pub layout: Option<Layout>,
    pub rect: Option<Rect>,
    pub frame: Option<Frame>,
    pub selected: i32,
    pub hover: i32,
    /// 外部文件拖入时命中的格子，与鼠标悬停独立
    pub drop_hover: i32,
    pub press: Option<Press>,
    pub drag: Option<Drag>,
    /// 已交给系统拖放的源格，拖放结束前固定为空，图标刷新跳过它
    pub drag_source: i32,
    pub moving: Option<Move>,
    pub label: Option<Label>,
    pub metrics: Metrics,
    pub previous: Option<(f32, f32)>,
    pub heart_flash: Option<f32>,
    pub heart_previous: f32,
    pub heart_step: u8,
    pub heart_at: u64,
    pub air_burst: Option<(i32, i32)>,
    pub air_at: u64,
    pub tracked: bool,
    pub shown: bool,
    pub visible: bool,
    /// 物品栏打开期间临时隐藏状态栏，配置里的可见性不变
    pub hidden_by_inventory: bool,
    /// 拖放接受区域的布局指纹，变化时才重算
    pub zones_key: String,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    // 窗口创建前到达的配置先缓存，初始化后补绘
    static PENDING: RefCell<Option<HudConfig>> = const { RefCell::new(None) };
}

/// 渲染期间的重入消息直接忽略，避免 RefCell 冲突。
pub fn with_state<T>(f: impl FnOnce(&mut State) -> T) -> Option<T> {
    STATE.with(|cell| {
        let mut slot = cell.try_borrow_mut().ok()?;
        slot.as_mut().map(f)
    })
}

pub fn init(app: &AppHandle) {
    // 状态栏属于桌面层：顶层窗口置底、点击不激活，所有者设为桌面以随显示桌面保留
    host::attach_app(app);
    let options = host::Options { click_through: false, desktop: true, panel: false };
    let Some(host) = Host::create("CraftSharpHud", "CraftSharp HUD", options, dispatch)
    else {
        return;
    };
    host.install_drop(app, "hud");
    host.install_input();

    let state = State {
        app: app.clone(),
        host,
        config: None,
        style: None,
        icons: (0..11).map(|_| None).collect(),
        missing: vec![false; 11],
        icon_keys: vec![String::new(); 11],
        layout: None,
        rect: None,
        frame: None,
        selected: -1,
        hover: -1,
        drop_hover: -1,
        press: None,
        drag: None,
        drag_source: -1,
        moving: None,
        label: None,
        metrics: Metrics::default(),
        previous: None,
        heart_flash: None,
        heart_previous: 0.0,
        heart_step: 0,
        heart_at: 0,
        air_burst: None,
        air_at: 0,
        tracked: false,
        shown: false,
        visible: true,
        hidden_by_inventory: false,
        zones_key: String::new(),
    };

    STATE.with(|cell| *cell.borrow_mut() = Some(state));
    let pending = PENDING.with(|cell| cell.borrow_mut().take());
    if let Some(config) = pending {
        apply(app, config);
    }
    preload_font(app);
    start_metrics(app);
}

/// 字体文件很大，提前在后台解析好，第一次显示文件名不再停顿。
fn preload_font(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Some(font) = text::parse() {
            let _ = app.run_on_main_thread(move || text::install(font));
        }
    });
}

/// 指标采集会查询 PDH 与 WMI，放到后台线程按秒采样，结果投递回窗口线程。
fn start_metrics(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        let values = metrics_of();
        let failed = app
            .run_on_main_thread(move || {
                with_state(|state| tick_metrics(state, values));
                crate::hud::crosshair::set_metrics(values);
                crate::hud::bossbar::set_metrics(values);
            })
            .is_err();
        if failed {
            break;
        }
        std::thread::sleep(Duration::from_secs(1));
    });
}

/// 前端推送最新配置，窗口尺寸随可见元素变化，位图与几何同帧提交。
pub fn apply(app: &AppHandle, config: HudConfig) {
    if with_state(|state| apply_inner(state, config.clone())).is_none() {
        PENDING.with(|cell| *cell.borrow_mut() = Some(config));
        return;
    }
    let _ = app;
}

fn apply_inner(state: &mut State, config: HudConfig) {
        let show_target = state.config.as_ref().map(|old| old.show_target_icon);
        let style_changed = state
            .config
            .as_ref()
            .map(|old| style_key(old) != style_key(&config))
            .unwrap_or(true);
        let icons_changed = show_target != Some(config.show_target_icon)
            || state
                .config
                .as_ref()
                .map(|old| slots_key(old) != slots_key(&config))
                .unwrap_or(true);

        if style_changed || state.style.is_none() {
            state.style = Some(FrameStyle::load(&config));
        }
        state.visible = config.visible && !state.hidden_by_inventory;
        if !config.show_file_name {
            state.label = None;
        }
        state.config = Some(config);
        // 拖放结束且源格已按新数据清空后，解除源格固定
        if state.drag_source >= 0
            && state.config.as_ref().and_then(|config| config.slot(state.drag_source)).is_none()
        {
            state.drag_source = -1;
        }
        if !state.config.as_ref().map(|config| config.hover_effect).unwrap_or(false) {
            state.drop_hover = -1;
        }
        if icons_changed {
            refresh_icons(state);
        }
        render(state);
}

fn style_key(config: &HudConfig) -> String {
    let elements = &config.elements;
    format!(
        "{}|{}|{}|{}",
        elements.health.style, elements.food.style, elements.absorbing.style, elements.exp_bar.style
    )
}

fn slots_key(config: &HudConfig) -> String {
    let mut key = String::new();
    for slot in &config.slots {
        key.push_str(&slot.index.to_string());
        key.push('|');
        key.push_str(slot.path.as_deref().unwrap_or(""));
        key.push('|');
        key.push_str(slot.name.as_deref().unwrap_or(""));
        key.push(';');
    }
    key
}

fn refresh_icons(state: &mut State) {
    let Some(config) = &state.config else { return };
    let scale = config.scale * state.host.dpi();
    let size = (layout::SLOT * scale).round().max(1.0) as u32;
    let show_target = config.show_target_icon;
    let paths: Vec<Option<String>> =
        (0..11).map(|index| config.slot(index as i32).and_then(|slot| slot.path.clone())).collect();
    let app = state.app.clone();
    let mut changed = false;

    for (index, path) in paths.into_iter().enumerate() {
        // 正在拖出的源格固定为空，后台解码完成也不装回去
        if index as i32 == state.drag_source {
            continue;
        }
        let key = match &path {
            Some(path) => format!("{size}|{show_target}|{}|{path}", file_stamp(path)),
            None => String::new(),
        };
        if !key.is_empty() && state.icon_keys[index] == key {
            continue;
        }
        state.icon_keys[index] = key.clone();
        state.missing[index] = false;

        let Some(path) = path else {
            state.icons[index] = None;
            changed = true;
            continue;
        };

        // 命中缓存直接装，未命中交给后台线程，旧图标先留着避免闪空
        match crate::icons::cached(&path, show_target, size) {
            Some(entry) => changed |= install_icon_value(state, &key, entry, size),
            None => {
                let app = app.clone();
                std::thread::spawn(move || {
                    let decoded = crate::icons::decoded(&path, show_target, size);
                    let _ = app.run_on_main_thread(move || install_icon(&key, decoded, size));
                });
            }
        }
    }

    if changed {
        render(state);
    }
}

/// 后台解码完成：按 key 找到所有对应格子装上，已经换了配置的格子直接忽略。
pub fn install_icon(key: &str, entry: Option<Arc<crate::icons::Decoded>>, size: u32) {
    with_state(|state| {
        if install_icon_value(state, key, entry, size) {
            render(state);
        }
    });
}

fn install_icon_value(state: &mut State, key: &str, entry: Option<Arc<crate::icons::Decoded>>, size: u32) -> bool {
    let mut changed = false;
    for index in 0..state.icon_keys.len() {
        if state.icon_keys[index] != key {
            continue;
        }
        if index as i32 == state.drag_source {
            continue;
        }
        changed = true;
        match &entry {
            Some(decoded) => {
                state.icons[index] = Some(SlotIcon {
                    sprite: Rc::new(sprite::from_rgba(decoded.size, decoded.size, &decoded.pixels)),
                });
                state.missing[index] = false;
            }
            None => {
                state.missing[index] = true;
                state.icons[index] = barrier_icon(size);
            }
        }
    }
    changed
}

fn file_stamp(path: &str) -> u128 {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn barrier_icon(size: u32) -> Option<SlotIcon> {
    let raw = sprite::load("item/barrier.png")?;
    Some(SlotIcon { sprite: Rc::new(raw.resized(size, size, false)) })
}

pub fn render(state: &mut State) {
    let Some(config) = state.config.clone() else { return };

    let scale = config.scale * state.host.dpi();
    let layout = layout::compute(scale, config.offhand(), config.visibility(), config.elements.absorbing.max_i());
    update_drop_zones(state, &layout);

    let Some(style) = &state.style else { return };
    let width = layout.width.ceil().max(1.0) as u32;
    let height = layout.height.ceil().max(1.0) as u32;

    let (mut x, mut y) = match &state.rect {
        Some(rect) => (
            rect.x + (rect.core_left - layout.core_left).round() as i32,
            rect.y + rect.height as i32 - height as i32,
        ),
        None => initial_position(state, &config, width, height, layout.content_top),
    };
    if let Some(moving) = &state.moving {
        let cursor = state.host.cursor();
        x = moving.origin.0 + cursor.x - moving.cursor.x;
        y = moving.origin.1 + cursor.y - moving.cursor.y;
    }
    let work = state.host.work_area();
    x = x.clamp(work.left, (work.right - width as i32).max(work.left));
    y = y.clamp(work.top, (work.bottom - height as i32).max(work.top));

    let mut model = config.clone();
    apply_metrics(&mut model, &state.metrics);

    let needs_frame = state.frame.as_ref().map(|f| f.width != width || f.height != height).unwrap_or(true);
    if needs_frame {
        state.frame = Some(Frame::new(width, height));
    }
    let overlay = build_overlay(
        &model,
        &state.icons,
        state.hover,
        state.drop_hover,
        state.selected,
        state.drag.as_ref(),
        state.heart_flash,
        state.air_burst,
    );

    let Some(frame) = &mut state.frame else { return };

    draw::draw(frame, &layout, style, &model, &state.icons, &overlay);
    if let Some(label) = &state.label {
        let alpha = label_alpha(label, host::ticks());
        if alpha > 0.0 {
            text::draw_label(frame, &layout, &label.text, label.color, (alpha * 255.0) as u8);
        }
    }

    state.host.set_band(layout.content_top);
    state.host.present(frame, x, y);

    let previous = state.rect.take();
    let resized = previous
        .as_ref()
        .map(|rect| rect.height != height || (rect.core_left - layout.core_left).abs() > 0.5)
        .unwrap_or(false);
    state.layout = Some(layout);
    state.rect = Some(Rect { x, y, height, core_left: layout.core_left });
    if resized && state.moving.is_none() {
        persist_position(state);
    }
    update_drag_icon(state);

    if state.visible {
        if !state.shown {
            state.shown = true;
            state.host.show();
            state.host.park();
        }
    } else if state.shown {
        state.shown = false;
        state.host.hide();
        dragicon::hide("hud");
    }
    schedule_anim(state);
}

/// 拖动浮层用独立窗口跟随光标，不画进状态栏帧里。
fn update_drag_icon(state: &State) {
    let Some(rect) = &state.rect else { return };
    let icon = state
        .drag
        .as_ref()
        .and_then(|drag| state.icons.get(drag.source as usize))
        .and_then(|icon| icon.as_ref());

    match (state.drag.as_ref(), icon) {
        (Some(drag), Some(icon)) => dragicon::show(
            "hud",
            &icon.sprite,
            rect.x + drag.x.round() as i32,
            rect.y + drag.y.round() as i32,
        ),
        _ => dragicon::hide("hud"),
    }
}

/// 状态栏当前是否可见，供托盘菜单生成动态文案。
pub fn is_visible() -> bool {
    with_state(|state| state.visible).unwrap_or(false)
}

/// 状态栏整体显隐，设置面板与物品栏遮罩期间都走这里。
pub fn set_visible(value: bool) {
    with_state(|state| {
        let value = value && !state.hidden_by_inventory;
        if state.visible == value {
            return;
        }
        state.visible = value;
        if value {
            render(state);
        } else if state.shown {
            state.shown = false;
            dragicon::hide("hud");
            state.host.hide();
        }
    });
}

/// 物品栏打开时临时隐藏状态栏，关闭后按配置恢复。
pub fn set_hidden_by_inventory(hidden: bool) {
    with_state(|state| {
        if state.hidden_by_inventory == hidden {
            return;
        }
        state.hidden_by_inventory = hidden;
        state.visible = state
            .config
            .as_ref()
            .map(|config| config.visible && !hidden)
            .unwrap_or(false);
        if state.visible {
            render(state);
        } else if state.shown {
            state.shown = false;
            dragicon::hide("hud");
            state.host.hide();
        }
    });
}

pub fn hidden_by_inventory() -> bool {
    with_state(|state| state.hidden_by_inventory).unwrap_or(false)
}

/// 前台回到外部应用时把桌面层窗口重新置底，
/// 修正显示桌面恢复后窗口停在应用之上的 z 序。一次性归位，不切换置顶，不会闪。
pub fn repark_desktop_windows() {
    with_state(|state| {
        if state.shown {
            state.host.park();
        }
    });
    crate::hud::bossbar::repark_desktop();
    crate::hud::crosshair::repark_desktop();
}

fn initial_position(state: &State, config: &HudConfig, width: u32, height: u32, band: f32) -> (i32, i32) {
    let dpi = state.host.dpi();
    if config.remember_position {
        if let Some(position) = &config.position {
            // 记录的是内容高度，不含顶部透明带
            let height_css = (height as f32 - band) / dpi;
            let saved_height = config.position_height.unwrap_or(height_css.ceil() as i32) as f32;
            let bottom = position.y as f32 + saved_height.max(height_css);
            return (
                (position.x as f32 * dpi).round() as i32,
                (bottom * dpi - height as f32).round() as i32,
            );
        }
    }
    let work = state.host.work_area();
    (
        work.left + ((work.right - work.left) - width as i32) / 2,
        work.bottom - height as i32,
    )
}

fn apply_metrics(config: &mut HudConfig, metrics: &Metrics) {
    let elements = &mut config.elements;
    for element in [
        &mut elements.health,
        &mut elements.food,
        &mut elements.air,
        &mut elements.armor,
        &mut elements.absorbing,
        &mut elements.exp_bar,
    ] {
        element.value = element.resolved(metrics);
    }
}

fn build_overlay<'a>(
    config: &HudConfig,
    icons: &'a [Option<SlotIcon>],
    hover: i32,
    drop_hover: i32,
    selected: i32,
    drag: Option<&Drag>,
    heart_flash: Option<f32>,
    air_burst: Option<(i32, i32)>,
) -> Overlay<'a> {
    let icon = drag.and_then(|drag| icons.get(drag.source as usize)?.as_ref());
    Overlay {
        hover_slot: hover,
        drop_hover_slot: drop_hover,
        selected_slot: selected,
        dimmed_slot: config.cut_slot,
        drag: icon,
        drag_source: drag.map(|drag| drag.source).unwrap_or(-1),
        drag_target: drag.map(|drag| drag.target).unwrap_or(-1),
        heart_flash,
        air_burst,
    }
}

/// 窗口显隐、缩放或副手变化时刷新拖放接受区域。
fn update_drop_zones(state: &mut State, layout: &Layout) {
    let key = format!(
        "{:.2}|{:.2}|{:.2}|{:.2}|{}|{}{}",
        layout.scale,
        layout.core_left,
        layout.hotbar_top,
        layout.slot_size,
        layout.visible.hotbar,
        layout.offhand.left,
        layout.offhand.right
    );
    if key == state.zones_key {
        return;
    }
    state.zones_key = key;

    let mut zones = Vec::new();
    if layout.visible.hotbar {
        let mut push = |index: i32, rect: layout::Rect| {
            zones.push(crate::dragdrop::Zone {
                id: layout::slot_id(index),
                left: rect.left as f64,
                top: rect.top as f64,
                width: rect.width as f64,
                height: rect.height as f64,
            });
        };
        for index in 0..9 {
            push(index + 2, layout.slot_drop_rect(index));
        }
        if layout.offhand.left {
            push(0, layout.offhand_drop_rect(0));
        }
        if layout.offhand.right {
            push(1, layout.offhand_drop_rect(1));
        }
    }
    crate::dragdrop::set_zones("hud", zones);
}

/// 交换两个格子的图标缓存，落点立即生效，配置回传时不再重载。
pub fn swap_icons(state: &mut State, from: i32, to: i32) {
    let (from, to) = (from as usize, to as usize);
    if from == to || from >= state.icons.len() || to >= state.icons.len() {
        return;
    }
    state.icons.swap(from, to);
    state.icon_keys.swap(from, to);
    state.missing.swap(from, to);
}

fn label_alpha(label: &Label, now: u64) -> f32 {
    let elapsed = now.saturating_sub(label.shown_at);
    const SHOW: u64 = 2000;
    const FADE: u64 = 500;
    if elapsed < SHOW {
        1.0
    } else if elapsed < SHOW + FADE {
        1.0 - (elapsed - SHOW) as f32 / FADE as f32
    } else {
        0.0
    }
}

pub fn show_label(state: &mut State, slot: i32) {
    if slot < 2 {
        state.label = None;
        return;
    }
    let Some(config) = &state.config else { return };
    if !config.show_file_name {
        state.label = None;
        return;
    }
    let Some(item) = config.slot(slot) else {
        state.label = None;
        return;
    };
    if state.missing.get(slot as usize).copied().unwrap_or(false) {
        state.label = None;
        return;
    }
    let Some(name) = item.name.clone() else {
        state.label = None;
        return;
    };
    let color = match config.file_name_color.as_str() {
        "auto" | "" => text::auto_color(&name),
        value => text::parse_color(value),
    };
    state.label = Some(Label { text: name, color, shown_at: host::ticks() });
}

/// 外部文件拖入悬停：只影响选中框，不改变鼠标悬停状态。
pub fn set_drop_hover(zone: Option<&str>) {
    with_state(|state| {
        let enabled = state.config.as_ref().map(|config| config.hover_effect).unwrap_or(false);
        let next = match zone {
            Some(id) if enabled => layout::slot_index(id).unwrap_or(-1),
            _ => -1,
        };
        if state.drop_hover != next {
            state.drop_hover = next;
            render(state);
        }
    });
}

/// 指标变化时更新数值，并触发与原版一致的闪烁动画。
pub fn tick_metrics(state: &mut State, metrics: Metrics) {
    state.metrics = metrics;
    let Some(config) = state.config.clone() else { return };
    let health = config.elements.health.resolved(&state.metrics);
    let air = config.elements.air.resolved(&state.metrics);
    let now = host::ticks();

    if let Some((previous_health, previous_air)) = state.previous {
        let health_element = &config.elements.health;
        if previous_health != health && health_element.regen && !health_element.custom {
            state.heart_flash = Some(previous_health);
            state.heart_previous = previous_health;
            state.heart_step = 1;
            state.heart_at = now + 200;
        }
        let air_element = &config.elements.air;
        if air < previous_air && air_element.regen && !air_element.custom {
            state.air_burst = Some(((air / 2.0).floor() as i32, (previous_air / 2.0).floor() as i32));
            state.air_at = now + 200;
        }
    }
    state.previous = Some((health, air));
    render(state);
}

fn metrics_of() -> Metrics {
    let value = crate::metrics::collect();
    Metrics {
        battery: value.battery,
        memory: value.memory,
        cpu: value.cpu,
        gpu: value.gpu,
    }
}

/// 生命值闪烁 200/100/200，空气破裂持续 200ms。
pub fn tick_anim(state: &mut State) {
    let now = host::ticks();
    if state.heart_step > 0 && now >= state.heart_at {
        match state.heart_step {
            1 => {
                state.heart_flash = None;
                state.heart_step = 2;
                state.heart_at = now + 100;
            }
            2 => {
                state.heart_flash = Some(state.heart_previous);
                state.heart_step = 3;
                state.heart_at = now + 200;
            }
            _ => {
                state.heart_flash = None;
                state.heart_step = 0;
            }
        }
    }
    if state.air_burst.is_some() && now >= state.air_at {
        state.air_burst = None;
    }
    render(state);
}

fn schedule_anim(state: &mut State) {
    let needs = state.air_burst.is_some() || state.heart_step > 0 || label_active(state);
    state.host.timer(TIMER_ANIM, 40, needs);
}

fn label_active(state: &State) -> bool {
    state
        .label
        .as_ref()
        .map(|label| label_alpha(label, host::ticks()) > 0.0)
        .unwrap_or(false)
}

/// 用户拖动结束后把位置换算成 CSS 像素交给前端落盘。
pub fn persist_position(state: &State) {
    let Some(rect) = &state.rect else { return };
    let remember = state.config.as_ref().map(|config| config.remember_position).unwrap_or(false);
    if !remember {
        return;
    }
    let dpi = state.host.dpi();
    // 落盘内容顶与内容高，顶部透明带不计入，恢复时按同一口径换算
    let band = state.layout.as_ref().map(|layout| layout.content_top).unwrap_or(0.0);
    let _ = state.app.emit(
        "hud-moved",
        serde_json::json!({
            "x": (rect.x as f32 / dpi).round() as i32,
            "y": ((rect.y as f32 + band) / dpi).round() as i32,
            "height": ((rect.height as f32 - band) / dpi).round() as i32,
        }),
    );
}

fn dispatch(event: Event) {
    with_state(|state| match event {
        Event::Move(x, y) => input::on_move(state, x, y),
        Event::Leave => input::on_leave(state),
        Event::HoverClear => input::clear_hover(state),
        Event::Down(x, y) => input::on_down(state, x, y),
        Event::Up(x, y) => input::on_up(state, x, y),
        Event::Menu(x, y) => input::on_menu(state, x, y),
        Event::Wheel(delta) => input::on_wheel(state, delta),
        Event::KeyDown(key) => {
            input::on_key(state, key);
        }
        Event::KeyUp(key) => input::on_key_up(key),
        Event::CaptureLost => input::on_capture_lost(state),
        Event::Timer(id) => {
            if id == TIMER_ANIM {
                tick_anim(state);
            }
        }
        Event::DpiChanged => {
            refresh_icons(state);
            render(state);
        }
    });
}
