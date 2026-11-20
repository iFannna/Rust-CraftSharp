//! Windows 后端：分层窗口、DIB 呈现、几何与消息分发。

use std::cell::RefCell;
use std::collections::HashMap;

use tauri::AppHandle;

use crate::hotkeys;
use crate::hud::host::{Area, Event, Options, Point};
use crate::hud::sprite::Frame;
use crate::hud::win32 as w;
use crate::hud::win32::Dib;

#[derive(Clone, Copy)]
struct Meta {
    dispatch: fn(Event),
    /// 顶部透明带高度，物理像素
    band: f32,
    click_through: bool,
}

thread_local! {
    static META: RefCell<HashMap<isize, Meta>> = RefCell::new(HashMap::new());
}

pub struct Host {
    hwnd: w::Hwnd,
    dib: Option<Dib>,
}

pub fn ticks() -> u64 {
    w::ticks()
}

impl Host {
    pub fn create(
        class: &str,
        title: &str,
        options: Options,
        dispatch: fn(Event),
    ) -> Option<Self> {
        let ex_style = if options.click_through { w::WS_EX_TRANSPARENT } else { 0 };
        let hwnd = w::create_named_window(class, title, wndproc, ex_style);
        if hwnd == 0 {
            return None;
        }
        META.with(|meta| {
            meta.borrow_mut().insert(
                hwnd,
                Meta { dispatch, band: 0.0, click_through: options.click_through },
            );
        });
        if options.desktop {
            w::set_desktop_style(hwnd);
            w::set_desktop_owner(hwnd);
            w::park_desktop(hwnd);
        } else if options.click_through {
            w::set_overlay_style(hwnd);
        }
        Some(Self { hwnd, dib: None })
    }

    pub fn install_drop(&self, app: &AppHandle, label: &str) {
        crate::dragdrop::install(app, label, self.hwnd);
    }

    pub fn install_input(&self) {
        crate::hud::input_win32::install_desktop_hooks();
    }

    pub fn dpi(&self) -> f32 {
        w::dpi_of(self.hwnd)
    }

    pub fn work_area(&self) -> Area {
        let rect = w::work_area(self.hwnd);
        Area { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    }

    pub fn cursor(&self) -> Point {
        let point = w::cursor_pos();
        Point { x: point.x, y: point.y }
    }

    pub fn present(&mut self, frame: &Frame, x: i32, y: i32) {
        self.present_pixels(frame.width, frame.height, &frame.pixels, x, y);
    }

    /// 直接提交预乘像素，拖动浮层和遮罩不经过 Frame。
    pub fn present_pixels(&mut self, width: u32, height: u32, pixels: &[u32], x: i32, y: i32) {
        if width == 0 || height == 0 || pixels.len() < (width * height) as usize {
            return;
        }
        let resized = self
            .dib
            .as_ref()
            .map(|dib| dib.width != width || dib.height != height)
            .unwrap_or(true);
        if resized {
            self.dib = Dib::new(width, height);
        }
        // SAFETY: 尺寸已核对，帧缓冲与 DIB 像素数量一致
        if let Some(dib) = &self.dib {
            unsafe {
                std::ptr::copy_nonoverlapping(pixels.as_ptr(), dib.bits, (width * height) as usize);
            }
            w::update_layered(self.hwnd, dib, x, y);
        }
    }

    pub fn set_band(&self, band: f32) {
        META.with(|meta| {
            if let Some(entry) = meta.borrow_mut().get_mut(&self.hwnd) {
                entry.band = band;
            }
        });
    }

    pub fn show(&self) {
        // SAFETY: 只显示窗口且不抢焦点
        unsafe {
            w::ShowWindow(self.hwnd, w::SW_SHOWNOACTIVATE);
        }
    }

    pub fn hide(&self) {
        // SAFETY: 只隐藏窗口
        unsafe {
            w::ShowWindow(self.hwnd, w::SW_HIDE);
        }
    }

    pub fn park(&self) {
        w::park_desktop(self.hwnd);
    }

    pub fn capture(&self) {
        // SAFETY: 捕获鼠标，保证拖出窗口后仍能收到移动
        unsafe {
            w::SetCapture(self.hwnd);
        }
    }

    pub fn release(&self) {
        // SAFETY: 释放鼠标捕获
        unsafe {
            w::ReleaseCapture();
        }
    }

    pub fn track_leave(&self) {
        w::track_leave(self.hwnd);
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        w::window_from_point(w::Point { x, y }) == self.hwnd
    }

    pub fn to_client(&self, x: i32, y: i32) -> Point {
        let point = w::to_client(self.hwnd, w::Point { x, y });
        Point { x: point.x, y: point.y }
    }

    pub fn to_screen(&self, x: i32, y: i32) -> Point {
        let point = w::to_screen(self.hwnd, w::Point { x, y });
        Point { x: point.x, y: point.y }
    }

    pub fn timer(&self, id: usize, interval: u32, active: bool) {
        // SAFETY: 只增减自身定时器
        unsafe {
            if active {
                w::SetTimer(self.hwnd, id, interval, 0);
            } else {
                w::KillTimer(self.hwnd, id);
            }
        }
    }

    /// 桌面层与置顶层之间切换，准星置顶使用。
    pub fn set_layer(&self, desktop: bool) {
        w::set_desktop_owner(self.hwnd);
        if desktop {
            w::set_desktop_style(self.hwnd);
            w::park_desktop(self.hwnd);
        } else {
            w::raise_overlay(self.hwnd);
        }
    }

    pub fn raise(&self) {
        w::raise_overlay(self.hwnd);
    }

    /// 离开置顶层但仍在普通窗口之上，物品栏遮罩使用。
    pub fn drop_topmost(&self) {
        // SAFETY: 只调整层级，不改位置尺寸
        unsafe {
            w::SetWindowPos(
                self.hwnd,
                w::HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                w::SWP_NOMOVE | w::SWP_NOSIZE | w::SWP_NOACTIVATE,
            );
        }
    }

    pub fn primary_area(&self) -> Area {
        let rect = w::primary_rect();
        Area { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    }
}

fn emit(meta: Option<Meta>, event: Event) {
    if let Some(meta) = meta {
        (meta.dispatch)(event);
    }
}

fn client_point(lparam: isize) -> (f32, f32) {
    let x = (lparam & 0xffff) as i16 as f32;
    let y = ((lparam >> 16) & 0xffff) as i16 as f32;
    (x, y)
}

unsafe extern "system" fn wndproc(hwnd: w::Hwnd, message: u32, wparam: usize, lparam: isize) -> isize {
    let meta = META.with(|entries| entries.borrow().get(&hwnd).copied());
    match message {
        w::WM_MOUSEACTIVATE => return w::MA_NOACTIVATE,
        w::WM_ERASEBKGND => return 1,
        w::WM_PAINT => {
            w::validate(hwnd);
            return 0;
        }
        w::WM_NCHITTEST => {
            let Some(meta) = meta else { return w::HTCLIENT };
            if meta.click_through {
                return w::HTTRANSPARENT;
            }
            // 顶部透明带只承载文件名，点击与悬停都交给下层桌面
            if meta.band > 0.0 {
                let point = w::Point {
                    x: (lparam & 0xffff) as i16 as i32,
                    y: ((lparam >> 16) & 0xffff) as i16 as i32,
                };
                if (w::to_client(hwnd, point).y as f32) < meta.band {
                    emit(Some(meta), Event::HoverClear);
                    return w::HTTRANSPARENT;
                }
            }
            return w::HTCLIENT;
        }
        w::WM_TIMER => {
            emit(meta, Event::Timer(wparam));
            return 0;
        }
        w::WM_DPICHANGED => {
            emit(meta, Event::DpiChanged);
            return 0;
        }
        w::WM_MOUSEMOVE => {
            let (x, y) = client_point(lparam);
            emit(meta, Event::Move(x, y));
            return 0;
        }
        w::WM_MOUSELEAVE => {
            emit(meta, Event::Leave);
            return 0;
        }
        w::WM_LBUTTONDOWN => {
            let (x, y) = client_point(lparam);
            emit(meta, Event::Down(x, y));
            return 0;
        }
        w::WM_LBUTTONUP => {
            let (x, y) = client_point(lparam);
            emit(meta, Event::Up(x, y));
            return 0;
        }
        w::WM_RBUTTONUP => {
            let (x, y) = client_point(lparam);
            emit(meta, Event::Menu(x, y));
            return 0;
        }
        w::WM_MOUSEWHEEL => {
            let delta = ((wparam >> 16) & 0xffff) as i16;
            emit(meta, Event::Wheel(delta));
            return 0;
        }
        w::WM_KEYDOWN | w::WM_SYSKEYDOWN => {
            emit(meta, Event::KeyDown(hotkeys::key_from_message(wparam, lparam)));
            return 0;
        }
        w::WM_KEYUP | w::WM_SYSKEYUP => {
            emit(meta, Event::KeyUp(hotkeys::key_from_message(wparam, lparam)));
            return 0;
        }
        w::WM_CAPTURECHANGED => {
            emit(meta, Event::CaptureLost);
            return 0;
        }
        _ => {}
    }
    w::DefWindowProcW(hwnd, message, wparam, lparam)
}
