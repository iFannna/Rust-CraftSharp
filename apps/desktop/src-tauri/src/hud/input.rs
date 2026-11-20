//! 状态栏指针交互：悬停、选择、长按拖拽、滚轮、右键菜单、文件拖放。
//! 平台事件由 host 归一成坐标和按键，本模块只维护交互状态。

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::Emitter;

use crate::hud::host;
use crate::hud::window::{self, Drag, Move, Press, State};

const LONG_PRESS_MS: u64 = 150;
const DRAG_THRESHOLD: f32 = 10.0;
/// 拖出窗口多少像素后转成系统拖放
const DRAG_OUT_MARGIN: f32 = 2.0;

/// 点击快捷栏视为取得键盘焦点，点击别处或切换前台窗口即失去。
static HOTBAR_KEY_ACTIVE: AtomicBool = AtomicBool::new(false);
/// 状态栏内的局部快捷键序列
static KEY_SEQUENCE: std::sync::Mutex<crate::hotkeys::SequenceState> =
    std::sync::Mutex::new(crate::hotkeys::SequenceState::new());

pub(crate) fn set_hotbar_active(active: bool) {
    HOTBAR_KEY_ACTIVE.store(active, Ordering::Relaxed);
    if !active {
        reset_sequence();
    }
}

pub(crate) fn hotbar_active() -> bool {
    HOTBAR_KEY_ACTIVE.load(Ordering::Relaxed)
}

/// 前台切到别的窗口，快捷栏不再持有键盘焦点。
pub(crate) fn focus_lost() {
    set_hotbar_active(false);
}

fn reset_sequence() {
    if let Ok(mut sequence) = KEY_SEQUENCE.lock() {
        sequence.reset();
    }
}

/// 光标是否落在快捷栏内容区，顶部文件名透明带不算。
pub(crate) fn hit_hotbar(state: &State, x: i32, y: i32) -> bool {
    if !state.visible || !state.shown || !state.host.contains(x, y) {
        return false;
    }
    let band = state.layout.as_ref().map(|layout| layout.content_top).unwrap_or(0.0);
    (state.host.to_client(x, y).y as f32) >= band
}

/// 快捷键入口：窗口消息只处理可见状态，全局钩子也走这里。
pub(crate) fn global_key(state: &mut State, key: u32) -> bool {
    if !state.visible || !state.shown || state.config.is_none() {
        return false;
    }
    on_key(state, key)
}

/// 桌面层窗口没有焦点，滚轮消息不会直达，钩子按命中补发。
pub(crate) fn wheel_at(state: &mut State, x: i32, y: i32, delta: i16) -> bool {
    if state.config.is_none() || !hit_hotbar(state, x, y) {
        return false;
    }
    on_wheel(state, delta);
    true
}

pub(crate) fn on_move(state: &mut State, x: f32, y: f32) {
    if !state.tracked {
        state.tracked = true;
        state.host.track_leave();
    }

    if state.moving.is_some() {
        window::render(state);
        return;
    }

    if state.drag.is_some() {
        if outside_hotbar(state, x, y) {
            drag_out(state);
            return;
        }
        let target = slot_at(state, x, y);
        if let Some(drag) = &mut state.drag {
            drag.x = x;
            drag.y = y;
            drag.target = target;
        }
        window::render(state);
        return;
    }

    if let Some(press) = &state.press {
        // 早于长按的移动不取消，松开时没进入拖动就仍算点击
        let distance = ((x - press.x).powi(2) + (y - press.y).powi(2)).sqrt();
        let ready = host::ticks().saturating_sub(press.at) >= LONG_PRESS_MS;
        if ready && distance > DRAG_THRESHOLD {
            start_drag(state, x, y);
        }
        return;
    }

    update_hover(state, slot_at(state, x, y));
}

pub(crate) fn on_leave(state: &mut State) {
    state.tracked = false;
    if state.hover != -1 {
        state.hover = -1;
        window::render(state);
    }
}

/// 顶部透明带不结束跟踪，只清掉悬停。
pub(crate) fn clear_hover(state: &mut State) {
    if state.hover != -1 {
        state.hover = -1;
        window::render(state);
    }
}

pub(crate) fn on_down(state: &mut State, x: f32, y: f32) {
    // 菜单是独立窗口且不会抢前台，点击快捷栏时先收起来，这次点击只用于关闭
    if close_slot_menu(state) {
        if slot_at(state, x, y) < 0 {
            select(state, -1);
        }
        return;
    }
    state.host.capture();

    let slot = slot_at(state, x, y);
    if slot < 0 {
        select(state, -1);
        let locked = state.config.as_ref().map(|config| config.locked).unwrap_or(false);
        if !locked {
            if let Some(rect) = &state.rect {
                state.moving = Some(Move {
                    cursor: state.host.cursor(),
                    origin: (rect.x, rect.y),
                });
            }
        }
        return;
    }

    state.press = Some(Press { slot, x, y, at: host::ticks() });
}

pub(crate) fn on_up(state: &mut State, x: f32, y: f32) {
    state.host.release();

    if state.moving.is_some() {
        state.moving = None;
        window::persist_position(state);
        return;
    }

    if state.drag.is_some() {
        let drag = state.drag.take().expect("drag");
        if drag.target >= 0 && drag.source != drag.target {
            // 先交换本地图标，避免配置回传前源格闪回旧图标
            window::swap_icons(state, drag.source, drag.target);
            let _ = state.app.emit(
                "hud-swap",
                serde_json::json!({ "source": drag.source, "target": drag.target }),
            );
        }
        window::render(state);
        return;
    }

    let Some(press) = state.press.take() else { return };
    let distance = ((x - press.x).powi(2) + (y - press.y).powi(2)).sqrt();
    // 移动超过阈值的按下是没进入拖动的拖动，不当作点击
    if distance <= DRAG_THRESHOLD {
        click(state, press.slot);
    }
}

pub(crate) fn on_menu(state: &mut State, x: f32, y: f32) {
    let slot = slot_at(state, x, y);
    if slot < 0 {
        close_slot_menu(state);
        return;
    }
    // 右键打开菜单时连同格子一起选中，和点击选中的高亮保持一致
    select(state, slot);
    let screen = state.host.to_screen(x as i32, y as i32);
    let _ = state.app.emit(
        "hud-menu",
        serde_json::json!({ "index": slot, "x": screen.x, "y": screen.y }),
    );
}

pub(crate) fn on_wheel(state: &mut State, delta: i16) {
    if state.selected < 2 {
        select(state, 2);
        return;
    }
    let current = state.selected;
    let next = if delta > 0 {
        if current == 2 { 10 } else { current - 1 }
    } else if current == 10 {
        2
    } else {
        current + 1
    };
    select(state, next);
}

/// 处理状态栏窗口内的快捷键，返回是否已经消费这个按键。
pub(crate) fn on_key(state: &mut State, key: u32) -> bool {
    if (0x31..=0x39).contains(&key) {
        select(state, (key - 0x30) as i32 + 1);
        return true;
    }

    if key == 0x0d {
        let selected = state.selected;
        if selected < 2 {
            return false;
        }
        let has_item = state
            .config
            .as_ref()
            .map(|config| config.slot(selected).is_some())
            .unwrap_or(false);
        if has_item {
            let _ = state.app.emit("hud-open", selected);
        }
        select(state, -1);
        return true;
    }

    let Some(config) = state.config.as_ref() else { return false };
    let drop_key = config.drop_key.clone();
    let open_key = config.open_inventory.clone();
    let selected = state.selected;

    let Ok(mut sequence) = KEY_SEQUENCE.lock() else { return false };
    sequence.press(key);

    // 状态栏聚焦时按局部快捷键开关物品栏，一次按下只切换一次
    if !sequence.fired() && sequence.matches(&open_key) {
        sequence.mark_fired();
        drop(sequence);
        let _ = state.app.emit("hud-open-inventory", ());
        return true;
    }

    // 自动重复继续触发，实现按住连续丢弃
    let drop_match = sequence.matches(&drop_key);
    drop(sequence);

    if drop_match {
        if selected >= 2 {
            let _ = state.app.emit("hud-drop", selected);
            return true;
        }
        return false;
    }

    false
}

pub(crate) fn on_key_up(key: u32) {
    if let Ok(mut sequence) = KEY_SEQUENCE.lock() {
        sequence.release(key);
    }
}

/// 拖出窗口后交给系统拖放，只提供复制，格子数据保持不变。
fn drag_out(state: &mut State) {
    let Some(drag) = state.drag.take() else { return };
    state.host.release();

    let missing = state.missing.get(drag.source as usize).copied().unwrap_or(false);
    let path = state
        .config
        .as_ref()
        .and_then(|config| config.slot(drag.source))
        .and_then(|slot| slot.path.clone())
        .filter(|path| !path.trim().is_empty() && !missing);
    let size = state.layout.as_ref().map(|layout| layout.slot_size.round().max(1.0) as u32).unwrap_or(32);

    let Some(path) = path else {
        window::render(state);
        return;
    };

    // 交接瞬间先把图标从格子里拿掉，系统拖放开始时格子已经是空的
    // 同时固定源格，拖放期间任何图标刷新都不再命中它
    state.drag_source = drag.source;
    let hidden = state.icons.get_mut(drag.source as usize).and_then(Option::take);
    window::render(state);

    let source = ("hud".to_string(), crate::hud::layout::slot_id(drag.source));
    let result = crate::dragdrop::begin_file_drag(path, size, Some(source));
    if result.dropped && !result.same_source {
        // 落点已由 Rust 原子搬移时不再二次清空；否则交给前端清空源格。
        // 两种情况下源格都保持固定，直到新配置确认它已经为空。
        if !result.handled {
            let _ = state.app.emit("hud-drop", drag.source);
        }
    } else {
        // 取消或落回原格子：图标还回去，格子数据本来就没动
        if let Some(icon) = hidden {
            state.icons[drag.source as usize] = Some(icon);
        }
        state.drag_source = -1;
        window::render(state);
    }
}

pub(crate) fn on_capture_lost(state: &mut State) {
    state.press = None;
    if state.drag.take().is_some() {
        window::render(state);
    }
    if state.moving.take().is_some() {
        window::persist_position(state);
    }
}

fn slot_at(state: &State, x: f32, y: f32) -> i32 {
    state.layout.as_ref().map(|layout| layout.slot_at(x, y)).unwrap_or(-1)
}

/// 离开格子行就转成系统拖放，不用把鼠标拖出整块状态栏窗口
fn outside_hotbar(state: &State, x: f32, y: f32) -> bool {
    state
        .layout
        .as_ref()
        .map(|layout| {
            let rect = layout.drag_out_rect();
            let margin = DRAG_OUT_MARGIN * layout.scale;
            x < rect.left - margin
                || y < rect.top - margin
                || x > rect.left + rect.width + margin
                || y > rect.top + rect.height + margin
        })
        .unwrap_or(false)
}

/// 关闭快捷栏的右键菜单，返回关闭前是否打开着
fn close_slot_menu(state: &State) -> bool {
    use tauri::Manager;

    let Some(menu) = state.app.get_webview_window("slot-menu") else {
        return false;
    };
    let _ = menu.close();
    true
}

fn start_drag(state: &mut State, x: f32, y: f32) {
    let Some(press) = state.press.take() else { return };
    state.drag = Some(Drag { source: press.slot, target: press.slot, x, y });
    state.selected = -1;
    state.hover = -1;
    state.label = None;
    window::render(state);
}

fn update_hover(state: &mut State, slot: i32) {
    let config = match &state.config {
        Some(config) => config,
        None => return,
    };
    if !config.hover_effect {
        if state.hover != -1 {
            state.hover = -1;
            window::render(state);
        }
        return;
    }

    let visible = slot >= 2 && (state.selected == -1 || state.selected == slot);
    let next = if visible { slot } else { -1 };
    if next != state.hover {
        state.hover = next;
        window::render(state);
    }
}

fn click(state: &mut State, slot: i32) {
    let (click_mode, has_item) = match &state.config {
        Some(config) => (config.click_mode.clone(), config.slot(slot).is_some()),
        None => return,
    };

    if click_mode == "single" {
        if has_item {
            let _ = state.app.emit("hud-open", slot);
        }
        return;
    }

    if state.selected == slot {
        if !has_item {
            select(state, -1);
            return;
        }
        let _ = state.app.emit("hud-open", slot);
        select(state, -1);
        return;
    }

    select(state, slot);
}

fn select(state: &mut State, slot: i32) {
    state.selected = slot;
    if slot >= 2 {
        state.hover = -1;
        window::show_label(state, slot);
    } else {
        state.label = None;
    }
    window::render(state);
}
