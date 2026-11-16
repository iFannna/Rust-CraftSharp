#![allow(non_snake_case)]

//! 窗口动效与标题栏命中：DWM 过渡、原生显隐动画、最大化按钮分屏浮层。

use std::collections::HashSet;
use std::ffi::c_void;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

const DWMWA_TRANSITIONS_FORCEDISABLED: u32 = 3;

const GWLP_USERDATA: i32 = -21;
const WS_CHILD: u32 = 0x4000_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_CLIPSIBLINGS: u32 = 0x0400_0000;

const SWP_NOACTIVATE: u32 = 0x0010;
const SWP_SHOWWINDOW: u32 = 0x0040;
const SWP_ASYNCWINDOWPOS: u32 = 0x4000;

const WM_SIZE: u32 = 0x0005;
const WM_TIMER: u32 = 0x0113;
const WM_PAINT: u32 = 0x000F;
const WM_ERASEBKGND: u32 = 0x0014;
const WM_SHOWWINDOW: u32 = 0x0018;
const WM_DPICHANGED: u32 = 0x02E0;
const WM_NCHITTEST: u32 = 0x0084;
const WM_MOUSEMOVE: u32 = 0x0200;
const WM_LBUTTONDOWN: u32 = 0x0201;
const WM_LBUTTONUP: u32 = 0x0202;
const WM_NCMOUSEMOVE: u32 = 0x00A0;
const WM_NCMOUSELEAVE: u32 = 0x02A2;
const WM_MOUSELEAVE: u32 = 0x02A3;
const WM_NCLBUTTONDOWN: u32 = 0x00A1;
const WM_NCLBUTTONUP: u32 = 0x00A2;
const WM_NCDESTROY: u32 = 0x0082;
const WM_SYSCOMMAND: u32 = 0x0112;

const HTMAXBUTTON: isize = 9;
const SC_MAXIMIZE: usize = 0xF030;
const SC_RESTORE: usize = 0xF120;

const SW_HIDE: i32 = 0;
const TME_LEAVE: u32 = 0x0002;

const BUTTON_WIDTH: f64 = 46.0;
const TITLE_HEIGHT: f64 = 32.0;
const SUBCLASS_ID: usize = 0xC5A1;
const ARROW_CURSOR: u16 = 32512;
const NULL_BRUSH: i32 = 5;
const CLICK_GUARD: Duration = Duration::from_millis(300);
const HOVER_TIMER: usize = 1;
const HOVER_POLL_MS: u32 = 120;

const OVERLAY_CLASS: &str = "CraftSharpSnapOverlay";

#[repr(C)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}

#[repr(C)]
struct TrackMouseEventData {
    size: u32,
    flags: u32,
    hwnd: isize,
    hover_time: u32,
}

#[repr(C)]
struct WndClassW {
    style: u32,
    wnd_proc: Option<WndProc>,
    cls_extra: i32,
    wnd_extra: i32,
    instance: isize,
    icon: isize,
    cursor: isize,
    background: isize,
    menu_name: *const u16,
    class_name: *const u16,
}

type WndProc = unsafe extern "system" fn(isize, u32, usize, isize) -> isize;
type SubclassProc =
    Option<unsafe extern "system" fn(isize, u32, usize, isize, usize, usize) -> isize>;

#[link(name = "user32")]
extern "system" {
    fn IsIconic(hwnd: isize) -> i32;
    fn IsZoomed(hwnd: isize) -> i32;
    fn ShowWindow(hwnd: isize, command: i32) -> i32;
    fn GetClientRect(hwnd: isize, rect: *mut Rect) -> i32;
    fn GetCursorPos(point: *mut Point) -> i32;
    fn WindowFromPoint(point: Point) -> isize;
    fn SetTimer(hwnd: isize, id: usize, elapse: u32, func: usize) -> usize;
    fn KillTimer(hwnd: isize, id: usize) -> i32;
    fn GetDpiForWindow(hwnd: isize) -> u32;
    fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
    fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
    fn SetWindowPos(
        hwnd: isize,
        insert_after: isize,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        flags: u32,
    ) -> i32;
    fn SendMessageW(hwnd: isize, message: u32, wparam: usize, lparam: isize) -> isize;
    fn RegisterClassW(class: *const WndClassW) -> u16;
    fn CreateWindowExW(
        ex_style: u32,
        class_name: *const u16,
        window_name: *const u16,
        style: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: isize,
        menu: isize,
        instance: isize,
        param: *mut c_void,
    ) -> isize;
    fn DestroyWindow(hwnd: isize) -> i32;
    fn GetModuleHandleW(name: *const u16) -> isize;
    fn LoadCursorW(instance: isize, name: *const u16) -> isize;
    fn GetStockObject(object: i32) -> isize;
    fn TrackMouseEvent(event: *mut TrackMouseEventData) -> i32;
    fn ValidateRect(hwnd: isize, rect: *const Rect) -> i32;
    fn DefWindowProcW(hwnd: isize, message: u32, wparam: usize, lparam: isize) -> isize;
}

#[link(name = "comctl32")]
extern "system" {
    fn SetWindowSubclass(hwnd: isize, proc_: SubclassProc, id: usize, data: usize) -> i32;
    fn RemoveWindowSubclass(hwnd: isize, proc_: SubclassProc, id: usize) -> i32;
    fn DefSubclassProc(hwnd: isize, message: u32, wparam: usize, lparam: isize) -> isize;
}

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(hwnd: isize, attribute: u32, value: *const c_void, size: u32) -> i32;
}

struct CaptionState {
    app: AppHandle,
    label: String,
    parent: isize,
    overlay: isize,
    hovering: bool,
    last_click: Option<Instant>,
}

fn installed() -> &'static Mutex<HashSet<isize>> {
    static SET: OnceLock<Mutex<HashSet<isize>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn set_transitions(hwnd: isize, disabled: bool) {
    let value: i32 = if disabled { 1 } else { 0 };
    // SAFETY: 只设置窗口属性，失败也不影响功能
    unsafe {
        DwmSetWindowAttribute(hwnd, DWMWA_TRANSITIONS_FORCEDISABLED, &value as *const i32 as *const c_void, 4);
    }
}

/// 关闭窗口显隐时的 DWM 过渡，用于 HUD 与快捷栏这类叠加窗口。
pub fn disable_transitions(hwnd: isize) {
    set_transitions(hwnd, true);
}

/// 打开系统过渡，让设置面板和 3D 预览恢复最大化/最小化动画。
pub fn enable_transitions(hwnd: isize) {
    set_transitions(hwnd, false);
}

fn emit_hover(state: &mut CaptionState, hovering: bool) {
    if state.hovering == hovering {
        return;
    }
    state.hovering = hovering;
    if state.overlay != 0 {
        unsafe {
            if hovering {
                SetTimer(state.overlay, HOVER_TIMER, HOVER_POLL_MS, 0);
            } else {
                KillTimer(state.overlay, HOVER_TIMER);
            }
        }
    }
    if let Some(window) = state.app.get_webview_window(&state.label) {
        let script = format!(
            "document.querySelector('[data-caption=\\\"maximize\\\"]')?.classList.toggle('caption-max-hover', {});",
            hovering
        );
        let _ = window.eval(&script);
    }
}

fn overlay_rect(hwnd: isize) -> Option<(i32, i32, i32, i32)> {
    let mut rect = Rect { left: 0, top: 0, right: 0, bottom: 0 };
    if unsafe { GetClientRect(hwnd, &mut rect) } == 0 {
        return None;
    }
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let scale = if dpi == 0 { 1.0 } else { f64::from(dpi) / 96.0 };
    let width = (BUTTON_WIDTH * scale).round().max(1.0) as i32;
    let height = (TITLE_HEIGHT * scale).round().max(1.0) as i32;
    let x = rect.right - width * 2;
    Some((x.max(0), 0, width, height))
}

fn sync_overlay(state: &mut CaptionState) {
    let overlay = state.overlay;
    if overlay == 0 {
        return;
    }

    if unsafe { IsZoomed(state.parent) } != 0 || unsafe { IsIconic(state.parent) } != 0 {
        emit_hover(state, false);
        unsafe {
            ShowWindow(overlay, SW_HIDE);
        }
        return;
    }

    if let Some((x, y, width, height)) = overlay_rect(state.parent) {
        unsafe {
            SetWindowPos(
                overlay,
                0,
                x,
                y,
                width,
                height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS,
            );
        }
    }
}

fn toggle_maximize(state: &mut CaptionState) {
    let now = Instant::now();
    let debounced = state
        .last_click
        .is_some_and(|last| now.duration_since(last) < CLICK_GUARD);
    if debounced {
        return;
    }
    state.last_click = Some(now);

    let command = if unsafe { IsZoomed(state.parent) } != 0 {
        SC_RESTORE
    } else {
        SC_MAXIMIZE
    };
    unsafe {
        SendMessageW(state.parent, WM_SYSCOMMAND, command, 0);
    }
}

fn track_leave(hwnd: isize) {
    let mut event = TrackMouseEventData {
        size: std::mem::size_of::<TrackMouseEventData>() as u32,
        flags: TME_LEAVE,
        hwnd,
        hover_time: 0,
    };
    unsafe {
        TrackMouseEvent(&mut event);
    }
}

unsafe extern "system" fn overlay_proc(
    hwnd: isize,
    message: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    let raw = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut CaptionState;

    match message {
        WM_NCHITTEST => {
            if !raw.is_null() {
                emit_hover(unsafe { &mut *raw }, true);
            }
            HTMAXBUTTON
        }
        WM_MOUSEMOVE | WM_NCMOUSEMOVE => {
            if !raw.is_null() {
                let state = unsafe { &mut *raw };
                if !state.hovering {
                    track_leave(hwnd);
                    emit_hover(state, true);
                }
            }
            0
        }
        WM_MOUSELEAVE | WM_NCMOUSELEAVE => {
            if !raw.is_null() {
                emit_hover(unsafe { &mut *raw }, false);
            }
            0
        }
        WM_TIMER => {
            if !raw.is_null() {
                let state = unsafe { &mut *raw };
                if !state.hovering {
                    unsafe {
                        KillTimer(hwnd, HOVER_TIMER);
                    }
                    return 0;
                }
                let mut point = Point { x: 0, y: 0 };
                let inside = unsafe { GetCursorPos(&mut point) } != 0
                    && unsafe { WindowFromPoint(point) } == state.overlay;
                if !inside {
                    emit_hover(state, false);
                }
            }
            0
        }
        WM_LBUTTONDOWN | WM_LBUTTONUP | WM_NCLBUTTONDOWN | WM_NCLBUTTONUP => {
            if !raw.is_null() {
                toggle_maximize(unsafe { &mut *raw });
            }
            0
        }
        WM_ERASEBKGND => 1,
        WM_PAINT => {
            unsafe {
                ValidateRect(hwnd, std::ptr::null());
            }
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

unsafe extern "system" fn parent_proc(
    hwnd: isize,
    message: u32,
    wparam: usize,
    lparam: isize,
    _id: usize,
    data: usize,
) -> isize {
    let state = data as *mut CaptionState;

    match message {
        WM_NCDESTROY => {
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            if !state.is_null() {
                unsafe {
                    let state_ref = &mut *state;
                    emit_hover(state_ref, false);
                    if state_ref.overlay != 0 {
                        DestroyWindow(state_ref.overlay);
                        state_ref.overlay = 0;
                    }
                    drop(Box::from_raw(state));
                }
            }
            unsafe {
                RemoveWindowSubclass(hwnd, Some(parent_proc), SUBCLASS_ID);
            }
            if let Ok(mut set) = installed().lock() {
                set.remove(&hwnd);
            }
            result
        }
        WM_SIZE | WM_DPICHANGED | WM_SHOWWINDOW => {
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            if !state.is_null() {
                sync_overlay(unsafe { &mut *state });
            }
            result
        }
        WM_NCMOUSEMOVE => {
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            if !state.is_null() {
                let state = unsafe { &mut *state };
                let hovering = wparam == HTMAXBUTTON as usize;
                if hovering && !state.hovering {
                    track_leave(hwnd);
                }
                emit_hover(state, hovering);
            }
            result
        }
        WM_NCMOUSELEAVE | WM_MOUSELEAVE => {
            if !state.is_null() {
                emit_hover(unsafe { &mut *state }, false);
            }
            unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
        }
        WM_NCLBUTTONDOWN | WM_NCLBUTTONUP if wparam == HTMAXBUTTON as usize => {
            if !state.is_null() {
                toggle_maximize(unsafe { &mut *state });
            }
            0
        }
        _ => unsafe { DefSubclassProc(hwnd, message, wparam, lparam) },
    }
}

fn overlay_class() -> Option<&'static [u16]> {
    static NAME: OnceLock<Vec<u16>> = OnceLock::new();
    static REGISTERED: OnceLock<bool> = OnceLock::new();
    let name = NAME.get_or_init(|| wide(OVERLAY_CLASS));
    let registered = *REGISTERED.get_or_init(|| unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let class = WndClassW {
            style: 0,
            wnd_proc: Some(overlay_proc),
            cls_extra: 0,
            wnd_extra: 0,
            instance,
            icon: 0,
            cursor: LoadCursorW(0, ARROW_CURSOR as *const u16),
            background: GetStockObject(NULL_BRUSH),
            menu_name: std::ptr::null(),
            class_name: name.as_ptr(),
        };
        RegisterClassW(&class) != 0
    });
    if registered {
        Some(name.as_slice())
    } else {
        None
    }
}

/// 给最大化按钮铺一层透明原生子窗口，让 Windows 11 悬停时弹出分屏布局。
pub fn install_caption_hook(hwnd: isize, app: AppHandle, label: String) {
    let Some(class) = overlay_class() else {
        return;
    };
    if let Ok(mut set) = installed().lock() {
        if !set.insert(hwnd) {
            return;
        }
    }

    let raw = Box::into_raw(Box::new(CaptionState {
        app,
        label,
        parent: hwnd,
        overlay: 0,
        hovering: false,
        last_click: None,
    }));

    let subclass_ok = unsafe {
        SetWindowSubclass(hwnd, Some(parent_proc), SUBCLASS_ID, raw as usize)
    };
    if subclass_ok == 0 {
        unsafe {
            drop(Box::from_raw(raw));
        }
        if let Ok(mut set) = installed().lock() {
            set.remove(&hwnd);
        }
        return;
    }

    let instance = unsafe { GetModuleHandleW(std::ptr::null()) };
    let overlay = unsafe {
        CreateWindowExW(
            0,
            class.as_ptr(),
            std::ptr::null(),
            WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
            0,
            0,
            1,
            1,
            hwnd,
            0,
            instance,
            std::ptr::null_mut(),
        )
    };

    if overlay == 0 {
        unsafe {
            RemoveWindowSubclass(hwnd, Some(parent_proc), SUBCLASS_ID);
            drop(Box::from_raw(raw));
        }
        if let Ok(mut set) = installed().lock() {
            set.remove(&hwnd);
        }
        return;
    }

    unsafe {
        SetWindowLongPtrW(overlay, GWLP_USERDATA, raw as isize);
        (*raw).overlay = overlay;
    }
    sync_overlay(unsafe { &mut *raw });
}
