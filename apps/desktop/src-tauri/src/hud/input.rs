//! 状态栏指针交互：悬停、选择、长按拖拽、滚轮、右键菜单、文件拖放。

#![allow(non_snake_case)]

use tauri::Emitter;

use crate::hud::win32 as w;
use crate::hud::window::{self, Drag, Move, Press, State};

const LONG_PRESS_MS: u64 = 150;
const DRAG_THRESHOLD: f32 = 10.0;

pub fn handle(message: u32, wparam: usize, lparam: isize) -> Option<isize> {
    match message {
        w::WM_MOUSEMOVE
        | w::WM_MOUSELEAVE
        | w::WM_LBUTTONDOWN
        | w::WM_LBUTTONUP
        | w::WM_RBUTTONUP
        | w::WM_MOUSEWHEEL
        | w::WM_KEYDOWN
        | w::WM_DROPFILES
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
        w::WM_DROPFILES => on_files(state, wparam as isize),
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
        let distance = ((x - press.x).powi(2) + (y - press.y).powi(2)).sqrt();
        let ready = w::ticks().saturating_sub(press.at) >= LONG_PRESS_MS;
        if ready {
            if distance > DRAG_THRESHOLD {
                start_drag(state, x, y);
            }
        } else if distance > DRAG_THRESHOLD {
            state.press = None;
        }
        return;
    }

    update_hover(state, slot_at(state, x, y));
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
            let _ = state.app.emit(
                "hud-swap",
                serde_json::json!({ "source": drag.source, "target": drag.target }),
            );
        }
        window::render(state);
        return;
    }

    let Some(press) = state.press.take() else { return };
    let _ = point_of(lparam);
    click(state, press.slot);
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

fn on_files(state: &mut State, drop: isize) {
    if drop == 0 {
        return;
    }
    let mut point = w::Point::default();
    // SAFETY: HDROP 句柄来自窗口消息，用完立即释放
    let has_point = unsafe { w::DragQueryPoint(drop, &mut point) } != 0;
    let count = unsafe { w::DragQueryFileW(drop, u32::MAX, std::ptr::null_mut(), 0) };

    if has_point && count > 0 {
        let mut buffer = vec![0u16; 32768];
        let length = unsafe { w::DragQueryFileW(drop, 0, buffer.as_mut_ptr(), buffer.len() as u32) };
        if length > 0 {
            let path = String::from_utf16_lossy(&buffer[..length as usize]);
            let slot = slot_at(state, point.x as f32, point.y as f32);
            if slot >= 0 {
                let _ = state
                    .app
                    .emit("hud-files", serde_json::json!({ "index": slot, "path": path }));
            }
        }
    }

    // SAFETY: 释放拖放句柄
    unsafe {
        w::DragFinish(drop);
    }
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
