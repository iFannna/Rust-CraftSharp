//! 状态栏指针交互：悬停、选择、长按拖拽、滚轮、右键菜单、文件拖放。

#![allow(non_snake_case)]

use tauri::Emitter;

use crate::hud::win32 as w;
use crate::hud::window::{self, Drag, Move, Press, State};

const LONG_PRESS_MS: u64 = 150;
const DRAG_THRESHOLD: f32 = 10.0;
/// 拖出窗口多少像素后转成系统拖放
const DRAG_OUT_MARGIN: f32 = 2.0;

pub fn handle(message: u32, wparam: usize, lparam: isize) -> Option<isize> {
    match message {
        w::WM_MOUSEMOVE
        | w::WM_MOUSELEAVE
        | w::WM_LBUTTONDOWN
        | w::WM_LBUTTONUP
        | w::WM_RBUTTONUP
        | w::WM_MOUSEWHEEL
        | w::WM_KEYDOWN
        | w::WM_CAPTURECHANGED => {
            window::with_state(|state| handle_message(state, message, wparam, lparam));
            Some(0)
        }
        _ => None,
    }
}

fn handle_message(state: &mut State, message: u32, wparam: usize, lparam: isize) {
    match message {
        w::WM_MOUSEMOVE => on_move(state, lparam),
        w::WM_MOUSELEAVE => on_leave(state),
        w::WM_LBUTTONDOWN => on_down(state, lparam),
        w::WM_LBUTTONUP => on_up(state, wparam, lparam),
        w::WM_RBUTTONUP => on_menu(state, lparam),
        w::WM_MOUSEWHEEL => on_wheel(state, wparam),
        w::WM_KEYDOWN => on_key(state, wparam),
        w::WM_CAPTURECHANGED => on_capture_lost(state),
        _ => {}
    }
}

fn point_of(lparam: isize) -> (f32, f32) {
    let x = (lparam & 0xffff) as i16 as f32;
    let y = ((lparam >> 16) & 0xffff) as i16 as f32;
    (x, y)
}

fn slot_at(state: &State, x: f32, y: f32) -> i32 {
    state.layout.as_ref().map(|layout| layout.slot_at(x, y)).unwrap_or(-1)
}

fn on_move(state: &mut State, lparam: isize) {
    let (x, y) = point_of(lparam);

    if !state.tracked {
        state.tracked = true;
        w::track_leave(state.hwnd);
    }

    if state.moving.is_some() {
        window::render(state);
        return;
    }

    if state.drag.is_some() {
        if outside_window(state, x, y) {
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
        let ready = w::ticks().saturating_sub(press.at) >= LONG_PRESS_MS;
        if ready && distance > DRAG_THRESHOLD {
            start_drag(state, x, y);
        }
        return;
    }

    update_hover(state, slot_at(state, x, y));
}

fn outside_window(state: &State, x: f32, y: f32) -> bool {
    state
        .layout
        .as_ref()
        .map(|layout| {
            x < -DRAG_OUT_MARGIN
                || y < -DRAG_OUT_MARGIN
                || x > layout.width + DRAG_OUT_MARGIN
                || y > layout.height + DRAG_OUT_MARGIN
        })
        .unwrap_or(false)
}

/// 拖出窗口后交给系统拖放，只提供复制，格子数据保持不变。
fn drag_out(state: &mut State) {
    let Some(drag) = state.drag.take() else { return };
    // SAFETY: 释放鼠标捕获，后续由 OLE 拖放接管
    unsafe {
        w::ReleaseCapture();
    }

    let missing = state.missing.get(drag.source as usize).copied().unwrap_or(false);
    let path = state
        .config
        .as_ref()
        .and_then(|config| config.slot(drag.source))
        .and_then(|slot| slot.path.clone())
        .filter(|path| !path.trim().is_empty() && !missing);
    let size = state.layout.as_ref().map(|layout| layout.slot_size.round().max(1.0) as u32).unwrap_or(32);

    window::render(state);

    if let Some(path) = path {
        crate::dragdrop::begin_file_drag(path, size);
    }
}

fn on_leave(state: &mut State) {
    state.tracked = false;
    if state.hover != -1 {
        state.hover = -1;
        window::render(state);
    }
}

fn on_down(state: &mut State, lparam: isize) {
    let (x, y) = point_of(lparam);
    // SAFETY: 捕获鼠标，保证拖出窗口后仍能收到移动
    unsafe {
        w::SetCapture(state.hwnd);
    }

    let slot = slot_at(state, x, y);
    if slot < 0 {
        select(state, -1);
        let locked = state.config.as_ref().map(|config| config.locked).unwrap_or(false);
        if !locked {
            if let Some(rect) = &state.rect {
                state.moving = Some(Move {
                    cursor: w::cursor_pos(),
                    origin: (rect.x, rect.y),
                });
            }
        }
        return;
    }

    state.press = Some(Press { slot, x, y, at: w::ticks() });
}

fn on_up(state: &mut State, wparam: usize, lparam: isize) {
    let _ = wparam;
    // SAFETY: 释放捕获
    unsafe {
        w::ReleaseCapture();
    }

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
    let (x, y) = point_of(lparam);
    let distance = ((x - press.x).powi(2) + (y - press.y).powi(2)).sqrt();
    // 移动超过阈值的按下是没进入拖动的拖动，不当作点击
    if distance <= DRAG_THRESHOLD {
        click(state, press.slot);
    }
}

fn on_wheel(state: &mut State, wparam: usize) {
    if state.selected < 2 {
        select(state, 2);
        return;
    }
    let delta = ((wparam >> 16) & 0xffff) as i16;
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

fn on_key(state: &mut State, wparam: usize) {
    let key = wparam as u8;

    if (0x31..=0x39).contains(&key) {
        select(state, (key - 0x30) as i32 + 1);
        return;
    }

    if key == 0x0d {
        let selected = state.selected;
        if selected < 2 {
            return;
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
        return;
    }

    let drop_key = state
        .config
        .as_ref()
        .map(|config| config.drop_key.to_lowercase())
        .unwrap_or_default();
    if drop_key.len() == 1 && drop_key.as_bytes()[0].to_ascii_uppercase() == key {
        if state.selected >= 2 {
            let _ = state.app.emit("hud-drop", state.selected);
        }
        return;
    }

    // 状态栏聚焦时按局部快捷键开关物品栏
    let open_key = state
        .config
        .as_ref()
        .map(|config| config.open_inventory.to_lowercase())
        .unwrap_or_default();
    if open_key.len() == 1 && open_key.as_bytes()[0].to_ascii_uppercase() == key {
        let _ = state.app.emit("hud-open-inventory", ());
    }
}

fn on_menu(state: &mut State, lparam: isize) {
    let (x, y) = point_of(lparam);
    let slot = slot_at(state, x, y);
    if slot < 0 {
        return;
    }
    let screen = w::to_screen(state.hwnd, w::Point { x: x as i32, y: y as i32 });
    let _ = state.app.emit(
        "hud-menu",
        serde_json::json!({ "index": slot, "x": screen.x, "y": screen.y }),
    );
}

fn on_capture_lost(state: &mut State) {
    state.press = None;
    if state.drag.take().is_some() {
        window::render(state);
    }
    if state.moving.take().is_some() {
        window::persist_position(state);
    }
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
