//! 物品栏：X11 宿主绘制、鼠标交互与实体预览跟随。

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use super::InventoryCfg;
use crate::hud::host::{self, Event, Host, Options};
use crate::hud::inventory_draw::{self, Layout, SlotIcon, Style};
use crate::hud::sprite::{self, Frame};
use crate::hud::tooltip;
use crate::hud::{dragicon, overlay};
use crate::slots::{self, SlotItem};

const ENTITY: &str = "entity-view";
const TIMER_LOOK: usize = 1;
const TIMER_HOVER: usize = 2;
const TIMER_REDRAW: usize = 3;
const LOOK_INTERVAL_MS: u32 = 16;
const HOVER_GREEN_MS: u64 = 250;
const LONG_PRESS_MS: u64 = 150;
const DRAG_THRESHOLD: f32 = 10.0;
const DOUBLE_CLICK_MS: u64 = 500;
const OUTSIDE_MARGIN: f32 = 4.0;
const ICON_MIN: f32 = 32.0;
const ICON_MAX: f32 = 128.0;

struct Press {
    slot: usize,
    x: f32,
    y: f32,
    at: u64,
}

struct Drag {
    source: usize,
    target: usize,
    x: f32,
    y: f32,
}

struct WindowMove {
    cursor: host::Point,
    origin: (i32, i32),
}

pub struct State {
    app: AppHandle,
    host: Host,
    config: InventoryCfg,
    style: Style,
    layout: Layout,
    unit: f32,
    dpi: f32,
    background: Rc<sprite::Sprite>,
    icons: Vec<Option<SlotIcon>>,
    icon_keys: Vec<String>,
    hover: Option<usize>,
    hover_at: u64,
    drop_hover: Option<usize>,
    press: Option<Press>,
    drag: Option<Drag>,
    /// 已交给系统拖放的源格，期间图标不随数据刷新重新出现
    drag_source: Option<usize>,
    hidden_icon: Option<(Option<SlotIcon>, String)>,
    moving: Option<WindowMove>,
    left_down: bool,
    last_click_slot: Option<usize>,
    last_click_at: u64,
    tooltip_slot: Option<usize>,
    hover_timer: bool,
    look_timer: bool,
    redraws: u8,
    entity_meta: Option<String>,
    last_look: Option<(i32, i32, i32, i32)>,
    frame: Option<Frame>,
    rect: Option<(i32, i32, u32, u32)>,
    shown: bool,
    visible: bool,
    hidden_status_bar: bool,
    configured: bool,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
static STARTED: AtomicBool = AtomicBool::new(false);

fn with_state<T>(f: impl FnOnce(&mut State) -> T) -> Option<T> {
    STATE.with(|cell| {
        let mut slot = cell.try_borrow_mut().ok()?;
        slot.as_mut().map(f)
    })
}

fn dispatch(event: Event) {
    let drag_out = with_state(|state| match event {
        Event::Move(x, y) => on_move(state, x, y),
        Event::Leave => {
            on_leave(state);
            false
        }
        Event::Down(x, y) => {
            on_down(state, x, y);
            false
        }
        Event::Up(x, y) => {
            on_up(state, x, y);
            false
        }
        Event::Menu(x, y) => {
            on_menu(state, x, y);
            false
        }
        Event::KeyDown(key) => {
            on_key(state, key);
            false
        }
        Event::KeyUp(_) => false,
        Event::CaptureLost => {
            on_capture_lost(state);
            false
        }
        Event::Timer(id) => {
            on_timer(state, id);
            false
        }
        Event::DpiChanged => {
            rebuild_layout(state, false);
            refresh_icons(state);
            render(state);
            false
        }
        _ => false,
    })
    .unwrap_or(false);
    if drag_out {
        start_system_drag();
    }
}

pub fn init(app: &AppHandle) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = APP.set(app.clone());
    host::attach_app(app);
    let options = Options { click_through: false, desktop: false, panel: true };
    let Some(host) = Host::create("CraftSharpInventory", "物品栏", options, dispatch) else {
        STARTED.store(false, Ordering::SeqCst);
        return;
    };
    host.install_drop(app, "inventory");

    let style = inventory_draw::find_style("inventory.png");
    let background = inventory_draw::container_sprite(style).unwrap_or_else(|| {
        Rc::new(sprite::Sprite { width: 176, height: 166, pixels: Vec::new() })
    });
    let layout = inventory_draw::compute(style, 6.0, &background);
    let state = State {
        app: app.clone(),
        host,
        config: InventoryCfg::default(),
        style,
        layout,
        unit: 6.0,
        dpi: 1.0,
        background,
        icons: Vec::new(),
        icon_keys: Vec::new(),
        hover: None,
        hover_at: 0,
        drop_hover: None,
        press: None,
        drag: None,
        drag_source: None,
        hidden_icon: None,
        moving: None,
        left_down: false,
        last_click_slot: None,
        last_click_at: 0,
        tooltip_slot: None,
        hover_timer: false,
        look_timer: false,
        redraws: 0,
        entity_meta: None,
        last_look: None,
        frame: None,
        rect: None,
        shown: false,
        visible: false,
        hidden_status_bar: false,
        configured: false,
    };
    STATE.with(|cell| *cell.borrow_mut() = Some(state));
}

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

        if style_changed {
            if let Some(sprite) = inventory_draw::container_sprite(style) {
                state.style = style;
                state.background = sprite;
            }
            hide_tooltip(state);
            state.hover = None;
            state.drop_hover = None;
            state.press = None;
            state.drag = None;
            state.drag_source = None;
            state.hidden_icon = None;
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
    state.dpi = state.host.dpi().max(1.0);
    let monitor = state.host.primary_area();
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
        if width != old_width || height != old_height {
            state.rect = Some((x, y, width, height));
        }
    }
    place_entity(state);
    sync_look_timer(state);
    push_drop_zones(state);
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

fn apply_geometry(state: &mut State) {
    let width = state.layout.width.ceil().max(1.0) as u32;
    let height = state.layout.height.ceil().max(1.0) as u32;
    let saved = if state.config.remember_position { state.config.position.clone() } else { None };
    let work = state.host.work_area();
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
    state.rect = Some((x, y, width, height));
}

fn clamp_to_work(x: i32, y: i32, width: u32, height: u32, work: host::Area) -> (i32, i32) {
    let max_x = (work.right - width as i32).max(work.left);
    let max_y = (work.bottom - height as i32).max(work.top);
    (x.clamp(work.left, max_x), y.clamp(work.top, max_y))
}

fn icon_size(state: &State) -> u32 {
    state.layout.slot_size.round().clamp(ICON_MIN, ICON_MAX) as u32
}

/// 拖动中的源格固定留空，系统拖放期间也不被刷新命中。
fn drag_source(state: &State, index: usize) -> bool {
    state.drag_source == Some(index) || state.drag.as_ref().map(|drag| drag.source) == Some(index)
}

fn file_stamp(path: &str) -> u128 {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn icon_from(entry: Option<Arc<crate::icons::Decoded>>, size: u32) -> Option<SlotIcon> {
    match entry {
        Some(decoded) => Some(SlotIcon {
            sprite: Rc::new(sprite::from_rgba(decoded.size, decoded.size, &decoded.pixels)),
        }),
        None => barrier_icon(size),
    }
}

fn barrier_icon(size: u32) -> Option<SlotIcon> {
    let raw = sprite::load("item/barrier.png")?;
    Some(SlotIcon { sprite: Rc::new(raw.resized(size, size, false)) })
}

fn install_icon(app: &AppHandle, key: &str, decoded: Option<Arc<crate::icons::Decoded>>, size: u32) {
    let _ = app;
    with_state(|state| {
        for index in 0..state.icon_keys.len() {
            if state.icon_keys[index] != key || drag_source(state, index) {
                continue;
            }
            state.icons[index] = icon_from(decoded.clone(), size);
        }
        render(state);
    });
}

fn refresh_icons(state: &mut State) {
    let scope = state.config.scope();
    let size = icon_size(state);
    let count = state.layout.slots.len();
    if state.icons.len() != count {
        state.icons.resize(count, None);
    }
    if state.icon_keys.len() != count {
        state.icon_keys.resize(count, String::new());
    }
    for (index, slot) in state.layout.slots.iter().enumerate() {
        if drag_source(state, index) {
            state.icons[index] = None;
            state.icon_keys[index].clear();
            continue;
        }
        let item = slots::get(&scope, &slot.id);
        let key = match &item {
            Some(item) => format!("{size}|{}", file_stamp(&item.path)),
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
        match crate::icons::cached(&item.path, false, size) {
            Some(entry) => state.icons[index] = icon_from(entry, size),
            None => {
                let app = state.app.clone();
                let path = item.path.clone();
                std::thread::spawn(move || {
                    let decoded = crate::icons::decoded(&path, false, size);
                    let app_for_install = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        install_icon(&app_for_install, &key, decoded, size);
                    });
                });
            }
        }
    }
}

fn hide_tooltip(state: &mut State) {
    if state.tooltip_slot.take().is_some() {
        tooltip::hide();
        state.host.timer(TIMER_HOVER, 0, false);
        state.hover_timer = false;
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

fn show_tooltip(state: &mut State, index: usize, item: &SlotItem) {
    if !state.config.show_tooltip {
        return;
    }
    let Some((x, y, _, _)) = state.rect else { return };
    let slot = &state.layout.slots[index];
    let (x, y) = (x as f32, y as f32);
    let anchor = tooltip::RectF {
        left: x + slot.left,
        top: y + slot.top,
        right: x + slot.left + slot.width,
        bottom: y + slot.top + slot.height,
    };
    let work = state.host.work_area();
    let work = tooltip::RectF {
        left: work.left as f32,
        top: work.top as f32,
        right: work.right as f32,
        bottom: work.bottom as f32,
    };
    let lines = super::tooltip_lines(&state.config, item);
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
                if let Some(item) = slots::get(&state.config.scope(), &state.layout.slots[index].id)
                {
                    show_tooltip(state, index, &item);
                }
            }
        }
        None => tooltip::hide(),
    }
}

fn on_timer(state: &mut State, id: usize) {
    if id == TIMER_LOOK {
        track_cursor(state);
    } else if id == TIMER_HOVER {
        state.host.timer(TIMER_HOVER, 0, false);
        state.hover_timer = false;
        render(state);
    } else if id == TIMER_REDRAW {
        if state.redraws == 0 {
            state.host.timer(TIMER_REDRAW, 0, false);
            return;
        }
        state.redraws -= 1;
        if state.redraws == 0 {
            state.host.timer(TIMER_REDRAW, 0, false);
        }
        render(state);
    }
}

/// 悬停停留一段时间后补绿色高亮，不阻塞鼠标移动
fn arm_hover_timer(state: &mut State) {
    if state.hover_timer {
        return;
    }
    state.hover_timer = true;
    state.host.timer(TIMER_HOVER, HOVER_GREEN_MS as u32, true);
}

fn sync_look_timer(state: &mut State) {
    let wanted = state.visible && state.config.show_model && state.layout.player.is_some();
    if wanted == state.look_timer {
        return;
    }
    state.look_timer = wanted;
    state.host.timer(TIMER_LOOK, LOOK_INTERVAL_MS, wanted);
    if wanted {
        state.last_look = None;
        track_cursor(state);
    }
}

fn hover_green(state: &State, index: usize) -> bool {
    slots::get(&state.config.scope(), &state.layout.slots[index].id).is_some()
        && host::ticks().saturating_sub(state.hover_at) >= HOVER_GREEN_MS
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

pub fn is_visible() -> bool {
    with_state(|state| state.visible).unwrap_or(false)
}

pub fn set_drop_hover(zone: Option<&str>) {
    with_state(|state| {
        state.drop_hover = zone.and_then(|id| inventory_draw::slot_index(&state.layout, id));
        render(state);
    });
}

pub fn slots_changed() {
    with_state(|state| {
        if !state.visible {
            return;
        }
        refresh_icons(state);
        refresh_tooltip(state);
        render(state);
    });
}

fn set_visible_inner(state: &mut State) {
    let visible = state.config.visible;
    state.visible = visible;
    let show_model = state.config.show_model;
    if visible && show_model {
        // 覆盖层按需创建，关闭模型时不占渲染进程
        let _ = state.app.emit("entity-view-warm", ());
    }
    let active = visible && show_model && state.layout.player.is_some();
    let _ = state.app.emit_to(ENTITY, "entity-active", serde_json::json!({ "visible": active }));

    overlay::set_visible(visible && state.config.gray_overlay, state.config.gray_overlay_opacity);

    if visible {
        if state.config.hide_status_bar && !crate::hud::hidden_by_inventory() {
            state.hidden_status_bar = true;
            crate::hud::set_hidden_by_inventory(true);
        }
        refresh_icons(state);
        render(state);
    } else {
        if state.hidden_status_bar {
            state.hidden_status_bar = false;
            crate::hud::set_hidden_by_inventory(false);
        }
        hide_tooltip(state);
        state.press = None;
        state.drag = None;
        state.drag_source = None;
        state.hidden_icon = None;
        state.hover = None;
        state.drop_hover = None;
        state.moving = None;
        state.left_down = false;
        state.last_click_slot = None;
        if state.shown {
            state.shown = false;
            state.host.hide();
        }
        state.host.timer(TIMER_REDRAW, 0, false);
        state.redraws = 0;
        dragicon::hide("inventory");
    }
    sync_entity_setup(state);
    place_entity(state);
    sync_look_timer(state);
}

fn request_close(state: &mut State) {
    state.config.visible = false;
    set_visible_inner(state);
    let _ = state.app.emit("inventory-visibility", false);
}

fn update_hover(state: &mut State, hover: Option<usize>) {
    if hover == state.hover {
        return;
    }
    state.hover = hover;
    state.hover_at = host::ticks();
    if hover.is_some() {
        arm_hover_timer(state);
    }
    sync_tooltip(state, hover);
    render(state);
}

fn outside(state: &State, x: f32, y: f32) -> bool {
    let (left, top, right, bottom) = state.layout.bounds;
    // 原版是 4 个界面像素，与格子缩放无关
    let margin = OUTSIDE_MARGIN * state.dpi;
    x < left - margin || y < top - margin || x > right + margin || y > bottom + margin
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
    // 交出去之前释放指针，否则系统拖放期间事件仍被本窗口独占
    state.host.release();
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

/// 系统拖放会阻塞当前线程，只在 State 未被借用时调用。
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

fn render(state: &mut State) {
    let width = state.layout.width.ceil().max(1.0) as u32;
    let height = state.layout.height.ceil().max(1.0) as u32;
    if state
        .frame
        .as_ref()
        .map(|frame| frame.width != width || frame.height != height)
        .unwrap_or(true)
    {
        state.frame = Some(Frame::new(width, height));
    }
    let dimmed = state
        .config
        .cut_slot
        .as_deref()
        .and_then(|id| inventory_draw::slot_index(&state.layout, id));
    let hover = state.drop_hover.or(state.hover);
    let green = state
        .hover
        .filter(|index| state.drop_hover.is_none() && hover_green(state, *index))
        .is_some();

    let model = inventory_draw::Model {
        layout: &state.layout,
        background: &state.background,
        icons: &state.icons,
        hover,
        hover_green: green,
        show_player: state.config.show_model,
        drag_source: state.drag.as_ref().map(|drag| drag.source).or(state.drag_source),
        dimmed,
    };
    let Some(frame) = &mut state.frame else { return };
    inventory_draw::draw(frame, &model);
    present(state);
}

fn present(state: &mut State) {
    // 先映射并提层，再写像素，避免被遮挡过的区域留下旧画面
    if state.visible && !state.shown {
        state.shown = true;
        state.host.show();
        state.host.focus();
        state.host.raise();
        raise_entity(state);
        // 映射完成前提交的帧会被 mutter 丢弃，映射后再补两帧
        state.redraws = 2;
        state.host.timer(TIMER_REDRAW, 120, true);
    }

    if let (Some(drag), Some(origin)) = (&state.drag, state.rect) {
        if let Some(Some(icon)) = state.icons.get(drag.source) {
            dragicon::show(
                "inventory",
                &icon.sprite,
                origin.0 + drag.x.round() as i32,
                origin.1 + drag.y.round() as i32,
            );
        }
    } else {
        dragicon::hide("inventory");
    }

    if let (Some((x, y, _, _)), Some(frame)) = (state.rect, state.frame.as_ref()) {
        state.host.present(frame, x, y);
    }
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
    let now = host::ticks();
    let double = state.last_click_slot == Some(index)
        && now.saturating_sub(state.last_click_at) < DOUBLE_CLICK_MS;
    if double {
        state.last_click_slot = None;
        state.last_click_at = 0;
        let _ = state.app.emit("inventory-open", &id);
    } else {
        state.last_click_slot = Some(index);
        state.last_click_at = now;
    }
}

/// 返回 true 表示拖拽离开物品栏，交由系统接管。
fn on_move(state: &mut State, x: f32, y: f32) -> bool {
    if let Some((cursor, origin)) = state.moving.as_ref().map(|moving| (moving.cursor, moving.origin)) {
        let now = state.host.cursor();
        let nx = origin.0 + now.x - cursor.x;
        let ny = origin.1 + now.y - cursor.y;
        if let Some((_, _, width, height)) = state.rect {
            state.rect = Some((nx, ny, width, height));
        }
        place_entity(state);
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

    if let Some(press) = &state.press {
        let distance = ((x - press.x).powi(2) + (y - press.y).powi(2)).sqrt();
        let ready = host::ticks().saturating_sub(press.at) >= LONG_PRESS_MS;
        if ready && distance > DRAG_THRESHOLD {
            let source = press.slot;
            state.press = None;
            state.drag = Some(Drag { source, target: source, x, y });
            state.hover = None;
            hide_tooltip(state);
            state.host.capture();
            render(state);
        }
        return false;
    }

    update_hover(state, inventory_draw::slot_at(&state.layout, x, y));
    false
}

fn on_down(state: &mut State, x: f32, y: f32) {
    state.left_down = true;
    state.host.capture();
    state.host.focus();

    let Some(index) = inventory_draw::slot_at(&state.layout, x, y) else {
        state.hover = None;
        sync_tooltip(state, None);
        if !state.config.locked {
            if let Some((wx, wy, _, _)) = state.rect {
                state.moving = Some(WindowMove { cursor: state.host.cursor(), origin: (wx, wy) });
            }
        }
        render(state);
        return;
    };
    state.press = Some(Press { slot: index, x, y, at: host::ticks() });
}

fn on_up(state: &mut State, x: f32, y: f32) {
    state.left_down = false;
    state.host.release();

    if state.moving.take().is_some() {
        persist_position(state);
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

fn on_menu(state: &mut State, x: f32, y: f32) {
    if state.drag.is_some() {
        return;
    }
    let Some(index) = inventory_draw::slot_at(&state.layout, x, y) else { return };
    let id = state.layout.slots[index].id.clone();
    let screen = state.host.to_screen(x as i32, y as i32);
    hide_tooltip(state);
    let _ = state.app.emit(
        "inventory-menu",
        serde_json::json!({ "slotId": id, "x": screen.x, "y": screen.y }),
    );
}

fn on_leave(state: &mut State) {
    if state.moving.is_some() || state.drag.is_some() {
        return;
    }
    state.hover = None;
    state.press = None;
    sync_tooltip(state, None);
    render(state);
}

fn on_capture_lost(state: &mut State) {
    state.press = None;
    if state.moving.take().is_some() {
        persist_position(state);
    }
    if state.drag.take().is_some() {
        render(state);
    }
}

fn on_key(state: &mut State, key: u32) {
    if key == 0x1b {
        request_close(state);
        return;
    }
    let Some(name) = char::from_u32(key).map(|value| value.to_ascii_lowercase()) else {
        return;
    };
    if state.config.open_inventory.eq_ignore_ascii_case(&name.to_string()) {
        request_close(state);
        return;
    }
    if !state.config.drop_key.eq_ignore_ascii_case(&name.to_string()) {
        return;
    }
    let Some(index) = state.hover else { return };
    let scope = state.config.scope();
    let id = state.layout.slots[index].id.clone();
    if slots::get(&scope, &id).is_some() {
        slots::clear(&scope, &id);
        refresh_icons(state);
        hide_tooltip(state);
        render(state);
    }
}

fn entity_xid(window: &tauri::WebviewWindow) -> Option<u32> {
    use gtk::glib::Cast;
    use gtk::prelude::*;

    let gtk_window = window.gtk_window().ok()?;
    let gdk_window = gtk_window.window()?;
    let x11 = gdk_window.downcast::<gdkx11::X11Window>().ok()?;
    Some(x11.xid() as u32)
}

fn raise_entity(state: &mut State) {
    if !state.visible || !state.config.show_model {
        return;
    }
    let Some(window) = state.app.get_webview_window(ENTITY) else { return };
    if let Some(xid) = entity_xid(&window) {
        state.host.restack_above(xid);
    }
}

/// 3D 覆盖层跟随物品栏一起直接出现，避免两个窗口各播一段开窗动画
fn no_window_animation(window: &tauri::WebviewWindow) {
    use gtk::prelude::*;

    if let Ok(gtk_window) = window.gtk_window() {
        gtk_window.set_type_hint(gtk::gdk::WindowTypeHint::Menu);
    }
}

/// 离屏窗口完成贴图加载后登记：置顶、补发参数、显示并定位
pub fn entity_ready() {
    with_state(|state| {
        let Some(window) = state.app.get_webview_window(ENTITY) else { return };
        no_window_animation(&window);
        let _ = window.set_always_on_top(true);
        state.entity_meta = None;
        sync_entity_setup(state);
        // 显示与隐藏都交给 place_entity，避免物品栏已关时窗口残留
        place_entity(state);
        raise_entity(state);
    });
}

fn sync_entity_setup(state: &mut State) {
    if state.layout.player.is_none() || !state.config.show_model {
        state.entity_meta = None;
        let _ = state.app.emit_to(ENTITY, "entity-active", serde_json::json!({ "visible": false }));
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
    let _ = state.app.emit_to(ENTITY, "entity-setup", payload);
    let visible = state.visible && state.layout.player.is_some();
    let _ = state.app.emit_to(ENTITY, "entity-active", serde_json::json!({ "visible": visible }));
}

/// 覆盖层贴住玩家区域；不可见或没有玩家区域时移出屏幕
fn place_entity(state: &mut State) {
    let Some(window) = state.app.get_webview_window(ENTITY) else { return };
    let target = if state.visible && state.config.show_model {
        state
            .rect
            .zip(state.layout.player.as_ref())
            .map(|((x, y, _, _), player)| {
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
        // 受管窗口移出屏幕会被窗口管理器拉回，直接收起来
        let _ = window.hide();
        let _ = state.app.emit_to(ENTITY, "entity-active", serde_json::json!({ "visible": false }));
        return;
    };
    let _ = window.show();
    let _ = window.set_position(tauri::PhysicalPosition::new(left, top));
    let _ = window.set_size(tauri::PhysicalSize::new(width as u32, height as u32));
    raise_entity(state);
}

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
    let work = state.host.work_area();
    let max_x = (neck_x - work.left as f32).max(work.right as f32 - neck_x).max(1.0);
    let max_y = (neck_y - work.top as f32).max(work.bottom as f32 - neck_y).max(1.0);
    let ratio_x = ((cursor_x - neck_x) / max_x).clamp(-1.0, 1.0);
    let ratio_y = ((cursor_y - neck_y) / max_y).clamp(-1.0, 1.0);
    let payload = serde_json::json!({
        "bodyYaw": ratio_x * 45.0,
        "bodyPitch": ratio_y * 10.0,
        "headPitch": ratio_y * 10.0,
    });
    let _ = state.app.emit_to(ENTITY, "entity-look", payload);
}

fn track_cursor(state: &mut State) {
    let cursor = state.host.cursor();
    let Some((x, y, _, _)) = state.rect else { return };
    let anchor = (cursor.x, cursor.y, x, y);
    if state.last_look == Some(anchor) {
        return;
    }
    state.last_look = Some(anchor);
    let point = state.host.to_client(cursor.x, cursor.y);
    sync_entity_look(state, point.x as f32, point.y as f32);
}


