//! 原生状态栏窗口：布局、绘制与窗口几何在同一次提交里完成。

#![allow(non_snake_case)]

use std::cell::RefCell;
use std::rc::Rc;

use tauri::{AppHandle, Emitter};

use crate::hud::config::{HudConfig, Metrics};
use crate::hud::draw::{self, FrameStyle, Overlay, SlotIcon};
use crate::hud::layout::{self, Layout};
use crate::hud::sprite::{self, Frame};
use crate::hud::text;
use crate::hud::win32 as w;
use crate::hud::win32::Dib;

pub const TIMER_METRICS: usize = 1;
pub const TIMER_ANIM: usize = 2;

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
    pub cursor: w::Point,
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
    pub hwnd: w::Hwnd,
    pub config: Option<HudConfig>,
    pub style: Option<FrameStyle>,
    pub icons: Vec<Option<SlotIcon>>,
    pub missing: Vec<bool>,
    pub icon_keys: Vec<String>,
    pub layout: Option<Layout>,
    pub dpi: f32,
    pub rect: Option<Rect>,
    pub dib: Option<Dib>,
    pub frame: Option<Frame>,
    pub selected: i32,
    pub hover: i32,
    pub press: Option<Press>,
    pub drag: Option<Drag>,
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
    let hwnd = w::create_window(wndproc);
    if hwnd == 0 {
        return;
    }
    // SAFETY: 窗口已创建，注册文件拖放与指标定时器
    unsafe {
        w::DragAcceptFiles(hwnd, 1);
        w::SetTimer(hwnd, TIMER_METRICS, 1000, 0);
    }

    let state = State {
        app: app.clone(),
        hwnd,
        config: None,
        style: None,
        icons: (0..11).map(|_| None).collect(),
        missing: vec![false; 11],
        icon_keys: vec![String::new(); 11],
        layout: None,
        dpi: w::dpi_of(hwnd),
        rect: None,
        dib: None,
        frame: None,
        selected: -1,
        hover: -1,
        press: None,
        drag: None,
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
    };

    STATE.with(|cell| *cell.borrow_mut() = Some(state));
    let pending = PENDING.with(|cell| cell.borrow_mut().take());
    if let Some(config) = pending {
        apply(app, config);
    }
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
        state.visible = config.visible;
        state.config = Some(config);
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
    let scale = config.scale * state.dpi;
    let size = (layout::SLOT * scale).round().max(1.0) as u32;
    let show_target = config.show_target_icon;

    for index in 0..11 {
        let path = config.slot(index as i32).and_then(|slot| slot.path.clone());
        let key = match &path {
            Some(path) => format!("{size}|{show_target}|{}|{path}", file_stamp(path)),
            None => String::new(),
        };
        if !key.is_empty() && state.icon_keys[index] == key {
            continue;
        }
        state.icon_keys[index] = key;
        state.missing[index] = false;

        let Some(path) = path else {
            state.icons[index] = None;
            continue;
        };

        match crate::icons::slot_icon_bytes(&path, show_target)
            .and_then(|bytes| sprite::load_scaled(&bytes, size, size, true))
        {
            Some(sprite) => state.icons[index] = Some(SlotIcon { sprite }),
            None => {
                state.missing[index] = true;
                state.icons[index] = barrier_icon(size);
            }
        }
    }
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
    let Some(style) = &state.style else { return };

    let scale = config.scale * state.dpi;
    let layout = layout::compute(scale, config.offhand(), config.visibility(), config.elements.absorbing.max_i());
    let width = layout.width.ceil().max(1.0) as u32;
    let height = layout.height.ceil().max(1.0) as u32;

    let (mut x, mut y) = match &state.rect {
        Some(rect) => (
            rect.x + (rect.core_left - layout.core_left).round() as i32,
            rect.y + rect.height as i32 - height as i32,
        ),
        None => initial_position(state, &config, width, height),
    };
    if let Some(moving) = &state.moving {
        let cursor = w::cursor_pos();
        x = moving.origin.0 + cursor.x - moving.cursor.x;
        y = moving.origin.1 + cursor.y - moving.cursor.y;
    }
    let work = w::work_area(state.hwnd);
    x = x.clamp(work.left, (work.right - width as i32).max(work.left));
    y = y.clamp(work.top, (work.bottom - height as i32).max(work.top));

    let mut model = config.clone();
    apply_metrics(&mut model, &state.metrics);

    let needs_frame = state.frame.as_ref().map(|f| f.width != width || f.height != height).unwrap_or(true);
    if needs_frame {
        state.frame = Some(Frame::new(width, height));
    }
    let needs_dib = state.dib.as_ref().map(|d| d.width != width || d.height != height).unwrap_or(true);
    if needs_dib {
        state.dib = Dib::new(width, height);
    }

    let overlay = build_overlay(
        &model,
        &state.icons,
        state.hover,
        state.selected,
        state.drag.as_ref(),
        state.heart_flash,
        state.air_burst,
    );

    let Some(dib) = &state.dib else { return };
    let Some(frame) = &mut state.frame else { return };

    draw::draw(frame, &layout, style, &model, &state.icons, &overlay);
    if let Some(label) = &state.label {
        let alpha = label_alpha(label, w::ticks());
        if alpha > 0.0 {
            text::draw_label(frame, &layout, &label.text, label.color, (alpha * 255.0) as u8);
        }
    }

    // SAFETY: 帧缓冲与 DIB 尺寸一致，目标指针由 DIB 持有
    unsafe {
        std::ptr::copy_nonoverlapping(frame.pixels.as_ptr(), dib.bits, (width * height) as usize);
    }
    w::update_layered(state.hwnd, dib, x, y);

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

    if state.visible {
        if !state.shown {
            state.shown = true;
            // SAFETY: 只是显示窗口且不抢焦点
            unsafe {
                w::ShowWindow(state.hwnd, w::SW_SHOWNOACTIVATE);
            }
        }
    } else if state.shown {
        state.shown = false;
        // SAFETY: 只是隐藏窗口
        unsafe {
            w::ShowWindow(state.hwnd, 0);
        }
    }
    schedule_anim(state);
}

/// 状态栏整体显隐，设置面板与物品栏遮罩期间都走这里。
pub fn set_visible(value: bool) {
    with_state(|state| {
        if state.visible == value {
            return;
        }
        state.visible = value;
        if value {
            render(state);
        } else if state.shown {
            state.shown = false;
            // SAFETY: 只是隐藏窗口
            unsafe {
                w::ShowWindow(state.hwnd, 0);
            }
        }
    });
}

fn initial_position(state: &State, config: &HudConfig, width: u32, height: u32) -> (i32, i32) {
    let dpi = state.dpi;
    if config.remember_position {
        if let Some(position) = &config.position {
            let height_css = height as f32 / dpi;
            let saved_height = config.position_height.unwrap_or(height_css.ceil() as i32) as f32;
            let bottom = position.y as f32 + saved_height.max(height_css);
            return (
                (position.x as f32 * dpi).round() as i32,
                (bottom * dpi - height as f32).round() as i32,
            );
        }
    }
    let work = w::work_area(state.hwnd);
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
    selected: i32,
    drag: Option<&Drag>,
    heart_flash: Option<f32>,
    air_burst: Option<(i32, i32)>,
) -> Overlay<'a> {
    let icon = drag.and_then(|drag| icons.get(drag.source as usize)?.as_ref());
    Overlay {
        hover_slot: hover,
        selected_slot: selected,
        dimmed_slot: config.cut_slot,
        drag: icon,
        drag_source: drag.map(|drag| drag.source).unwrap_or(-1),
        drag_x: drag.map(|drag| drag.x).unwrap_or(0.0),
        drag_y: drag.map(|drag| drag.y).unwrap_or(0.0),
        heart_flash,
        air_burst,
    }
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
    state.label = Some(Label { text: name, color, shown_at: w::ticks() });
}

/// 指标变化时更新数值，并触发与原版一致的闪烁动画。
pub fn tick_metrics(state: &mut State) {
    state.metrics = metrics_of();
    let Some(config) = state.config.clone() else { return };
    let health = config.elements.health.resolved(&state.metrics);
    let air = config.elements.air.resolved(&state.metrics);
    let now = w::ticks();

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
    let now = w::ticks();
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
    // SAFETY: 只增减自身定时器
    unsafe {
        if needs {
            w::SetTimer(state.hwnd, TIMER_ANIM, 40, 0);
        } else {
            w::KillTimer(state.hwnd, TIMER_ANIM);
        }
    }
}

fn label_active(state: &State) -> bool {
    state
        .label
        .as_ref()
        .map(|label| label_alpha(label, w::ticks()) > 0.0)
        .unwrap_or(false)
}

/// 用户拖动结束后把位置换算成 CSS 像素交给前端落盘。
pub fn persist_position(state: &State) {
    let Some(rect) = &state.rect else { return };
    let remember = state.config.as_ref().map(|config| config.remember_position).unwrap_or(false);
    if !remember {
        return;
    }
    let dpi = state.dpi;
    let _ = state.app.emit(
        "hud-moved",
        serde_json::json!({
            "x": (rect.x as f32 / dpi).round() as i32,
            "y": (rect.y as f32 / dpi).round() as i32,
            "height": (rect.height as f32 / dpi).round() as i32,
        }),
    );
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
        w::WM_TIMER => {
            if wparam == TIMER_METRICS {
                with_state(tick_metrics);
            } else if wparam == TIMER_ANIM {
                with_state(tick_anim);
            }
            return 0;
        }
        w::WM_DPICHANGED => {
            with_state(|state| {
                state.dpi = w::dpi_of(state.hwnd);
                refresh_icons(state);
                render(state);
            });
            return 0;
        }
        _ => {}
    }

    if let Some(result) = crate::hud::input::handle(message, wparam, lparam) {
        return result;
    }
    w::DefWindowProcW(hwnd, message, wparam, lparam)
}
