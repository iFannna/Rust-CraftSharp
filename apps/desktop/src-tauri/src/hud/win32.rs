//! 分层窗口所需的 Win32 绑定与 32 位 DIB 封装。

#![allow(non_snake_case)]

use std::ffi::c_void;
use std::ptr;

pub type Hwnd = isize;
pub type Hdc = isize;

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[repr(C)]
pub struct BlendFunction {
    blend_op: u8,
    blend_flags: u8,
    source_constant_alpha: u8,
    alpha_format: u8,
}

#[repr(C)]
struct BitmapInfoHeader {
    size: u32,
    width: i32,
    height: i32,
    planes: u16,
    bit_count: u16,
    compression: u32,
    size_image: u32,
    x_pels: i32,
    y_pels: i32,
    clr_used: u32,
    clr_important: u32,
}

#[repr(C)]
struct BitmapInfo {
    header: BitmapInfoHeader,
    colors: [u32; 1],
}

#[repr(C)]
pub struct WndClassW {
    style: u32,
    wnd_proc: Option<unsafe extern "system" fn(Hwnd, u32, usize, isize) -> isize>,
    cls_extra: i32,
    wnd_extra: i32,
    instance: isize,
    icon: isize,
    cursor: isize,
    background: isize,
    menu_name: *const u16,
    class_name: *const u16,
}

#[repr(C)]
pub struct MonitorInfo {
    size: u32,
    pub monitor: Rect,
    pub work: Rect,
    flags: u32,
}

#[repr(C)]
pub struct TrackMouseEventData {
    size: u32,
    flags: u32,
    hwnd: Hwnd,
    hover: u32,
}

#[link(name = "user32")]
extern "system" {
    pub fn RegisterClassW(class: *const WndClassW) -> u16;
    pub fn CreateWindowExW(
        ex_style: u32,
        class_name: *const u16,
        title: *const u16,
        style: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: Hwnd,
        menu: isize,
        instance: isize,
        param: *mut c_void,
    ) -> Hwnd;
    pub fn DefWindowProcW(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize) -> isize;
    pub fn ShowWindow(hwnd: Hwnd, command: i32) -> i32;
    pub fn SetWindowPos(hwnd: Hwnd, after: isize, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
    pub fn UpdateLayeredWindow(
        hwnd: Hwnd,
        dst: Hdc,
        dst_point: *const Point,
        size: *const Point,
        src: Hdc,
        src_point: *const Point,
        key: u32,
        blend: *const BlendFunction,
        flags: u32,
    ) -> i32;
    pub fn GetDC(hwnd: Hwnd) -> Hdc;
    pub fn ReleaseDC(hwnd: Hwnd, dc: Hdc) -> i32;
    pub fn GetCursorPos(point: *mut Point) -> i32;
    pub fn ClientToScreen(hwnd: Hwnd, point: *mut Point) -> i32;
    pub fn GetDpiForWindow(hwnd: Hwnd) -> u32;
    pub fn MonitorFromWindow(hwnd: Hwnd, flags: u32) -> isize;
    pub fn MonitorFromPoint(point: Point, flags: u32) -> isize;
    pub fn GetMonitorInfoW(monitor: isize, info: *mut MonitorInfo) -> i32;
    pub fn SetTimer(hwnd: Hwnd, id: usize, interval: u32, proc: usize) -> usize;
    pub fn KillTimer(hwnd: Hwnd, id: usize) -> i32;
    pub fn SetCapture(hwnd: Hwnd) -> Hwnd;
    pub fn ReleaseCapture() -> i32;
    pub fn SetForegroundWindow(hwnd: Hwnd) -> i32;
    pub fn GetAsyncKeyState(key: i32) -> i16;
    pub fn ValidateRect(hwnd: Hwnd, rect: *const Rect) -> i32;
    pub fn TrackMouseEvent(data: *mut TrackMouseEventData) -> i32;
    pub fn LoadCursorW(instance: isize, name: *const u16) -> isize;
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateCompatibleDC(dc: Hdc) -> Hdc;
    fn DeleteDC(dc: Hdc) -> i32;
    fn CreateDIBSection(dc: Hdc, info: *const BitmapInfo, usage: u32, bits: *mut *mut c_void, section: isize, offset: u32) -> isize;
    fn SelectObject(dc: Hdc, object: isize) -> isize;
    fn DeleteObject(object: isize) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    pub fn GetModuleHandleW(name: *const u16) -> isize;
    pub fn GetTickCount64() -> u64;
}

pub const WS_POPUP: u32 = 0x8000_0000;
pub const WS_EX_LAYERED: u32 = 0x0008_0000;
pub const WS_EX_TOPMOST: u32 = 0x0000_0008;
pub const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
pub const WS_EX_TRANSPARENT: u32 = 0x0000_0020;
pub const WS_EX_NOACTIVATE: u32 = 0x0800_0000;
pub const SW_SHOWNOACTIVATE: i32 = 4;
pub const SW_HIDE: i32 = 0;
pub const HWND_TOPMOST: isize = -1;
pub const HWND_NOTOPMOST: isize = -2;
pub const SWP_NOSIZE: u32 = 0x0001;
pub const SWP_NOMOVE: u32 = 0x0002;
pub const SWP_NOACTIVATE: u32 = 0x0010;
pub const ULW_ALPHA: u32 = 2;
pub const MONITOR_DEFAULTTONEAREST: u32 = 2;
pub const TME_LEAVE: u32 = 0x0000_0002;

pub const WM_PAINT: u32 = 0x000F;
pub const WM_KEYDOWN: u32 = 0x0100;
pub const WM_KEYUP: u32 = 0x0101;
pub const WM_MOUSEMOVE: u32 = 0x0200;
pub const WM_LBUTTONDOWN: u32 = 0x0201;
pub const WM_LBUTTONUP: u32 = 0x0202;
pub const WM_RBUTTONUP: u32 = 0x0205;
pub const WM_MBUTTONDOWN: u32 = 0x0207;
pub const WM_MOUSEWHEEL: u32 = 0x020A;
pub const WM_MOUSELEAVE: u32 = 0x02A3;
pub const WM_MOUSEACTIVATE: u32 = 0x0021;
pub const WM_ERASEBKGND: u32 = 0x0014;
pub const WM_NCHITTEST: u32 = 0x0084;
pub const WM_TIMER: u32 = 0x0113;
pub const WM_DPICHANGED: u32 = 0x02E0;
pub const WM_CAPTURECHANGED: u32 = 0x0215;
pub const HTCLIENT: isize = 1;
pub const MA_ACTIVATE: isize = 1;

/// 预乘 alpha 的 32 位 DIB，像素直接写进 `bits`。
pub struct Dib {
    dc: Hdc,
    bitmap: isize,
    old: isize,
    pub width: u32,
    pub height: u32,
    pub bits: *mut u32,
}

impl Dib {
    pub fn new(width: u32, height: u32) -> Option<Dib> {
        let width = width.max(1) as i32;
        let height = height.max(1) as i32;
        // SAFETY: 全部为创建 DIB 所需的只写参数
        unsafe {
            let screen = GetDC(0);
            let dc = CreateCompatibleDC(screen);
            ReleaseDC(0, screen);
            if dc == 0 {
                return None;
            }

            let info = BitmapInfo {
                header: BitmapInfoHeader {
                    size: std::mem::size_of::<BitmapInfoHeader>() as u32,
                    width,
                    height: -height,
                    planes: 1,
                    bit_count: 32,
                    compression: 0,
                    size_image: 0,
                    x_pels: 0,
                    y_pels: 0,
                    clr_used: 0,
                    clr_important: 0,
                },
                colors: [0],
            };

            let mut bits: *mut c_void = ptr::null_mut();
            let bitmap = CreateDIBSection(dc, &info, 0, &mut bits, 0, 0);
            if bitmap == 0 || bits.is_null() {
                DeleteDC(dc);
                return None;
            }
            let old = SelectObject(dc, bitmap);

            Some(Dib {
                dc,
                bitmap,
                old,
                width: width as u32,
                height: height as u32,
                bits: bits as *mut u32,
            })
        }
    }
}

impl Drop for Dib {
    fn drop(&mut self) {
        // SAFETY: 只释放自己创建的 GDI 对象
        unsafe {
            if self.old != 0 {
                SelectObject(self.dc, self.old);
            }
            DeleteObject(self.bitmap);
            DeleteDC(self.dc);
        }
    }
}

/// 位图、位置、尺寸在同一次调用里提交，窗口不存在中间态。
pub fn update_layered(hwnd: Hwnd, dib: &Dib, x: i32, y: i32) {
    let dst = Point { x, y };
    let size = Point { x: dib.width as i32, y: dib.height as i32 };
    let src = Point { x: 0, y: 0 };
    let blend = BlendFunction {
        blend_op: 0,
        blend_flags: 0,
        source_constant_alpha: 255,
        alpha_format: 1,
    };
    // SAFETY: 句柄与缓冲区均有效，生命周期覆盖整次调用
    unsafe {
        UpdateLayeredWindow(hwnd, 0, &dst, &size, dib.dc, &src, 0, &blend, ULW_ALPHA);
    }
}

/// 把帧像素拷进 DIB 后一次提交，避免只提交空位图。
pub fn present(hwnd: Hwnd, frame: &crate::hud::sprite::Frame, dib: &Dib, x: i32, y: i32) {
    if frame.width != dib.width || frame.height != dib.height {
        return;
    }
    // SAFETY: 帧与 DIB 尺寸已核对，像素数量一致
    unsafe {
        std::ptr::copy_nonoverlapping(frame.pixels.as_ptr(), dib.bits, frame.pixels.len());
    }
    update_layered(hwnd, dib, x, y);
}

/// 把浮层提到置顶窗口带的最前面。不带激活的显示会落在最底下，
/// 不重新排序就会被同样置顶的状态栏盖住。
pub fn raise_overlay(hwnd: Hwnd) {
    // SAFETY: 只调整层级，不改位置尺寸
    unsafe {
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

/// 拖动时跟随光标的浮层：置顶、鼠标穿透、不抢焦点。
pub fn create_overlay() -> Hwnd {
    create_named_window(
        "CraftSharpDragIcon",
        "CraftSharp Drag",
        DefWindowProcW,
        WS_EX_TRANSPARENT | WS_EX_NOACTIVATE,
    )
}

unsafe fn register_class(
    class_name: &[u16],
    proc_: unsafe extern "system" fn(Hwnd, u32, usize, isize) -> isize,
    background: isize,
) {
    let instance = GetModuleHandleW(ptr::null());
    let cursor = LoadCursorW(0, 32512usize as *const u16);
    let class = WndClassW {
        style: 0,
        wnd_proc: Some(proc_),
        cls_extra: 0,
        wnd_extra: 0,
        instance,
        icon: 0,
        cursor,
        background,
        menu_name: ptr::null(),
        class_name: class_name.as_ptr(),
    };
    RegisterClassW(&class);
}

/// 通用分层窗口，类名区分窗口用途，样式按需组合。
pub fn create_named_window(
    class_name: &str,
    title: &str,
    proc_: unsafe extern "system" fn(Hwnd, u32, usize, isize) -> isize,
    ex_style: u32,
) -> Hwnd {
    let class: Vec<u16> = format!("{class_name}\0").encode_utf16().collect();
    let caption: Vec<u16> = format!("{title}\0").encode_utf16().collect();
    // SAFETY: 固定类名与样式，窗口创建后由调用方持有
    unsafe {
        register_class(&class, proc_, 0);
        let instance = GetModuleHandleW(ptr::null());
        CreateWindowExW(
            ex_style | WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            class.as_ptr(),
            caption.as_ptr(),
            WS_POPUP,
            0,
            0,
            1,
            1,
            0,
            0,
            instance,
            ptr::null_mut(),
        )
    }
}

pub fn create_window(proc_: unsafe extern "system" fn(Hwnd, u32, usize, isize) -> isize) -> Hwnd {
    create_named_window("CraftSharpHud", "CraftSharp HUD", proc_, 0)
}

pub fn dpi_of(hwnd: Hwnd) -> f32 {
    // SAFETY: 只查询当前窗口 DPI
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        1.0
    } else {
        dpi as f32 / 96.0
    }
}

pub fn work_area(hwnd: Hwnd) -> Rect {
    let mut info = MonitorInfo {
        size: std::mem::size_of::<MonitorInfo>() as u32,
        monitor: Rect::default(),
        work: Rect::default(),
        flags: 0,
    };
    // SAFETY: 只读取当前显示器工作区
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor != 0 && GetMonitorInfoW(monitor, &mut info) != 0 {
            return info.work;
        }
    }
    Rect { left: 0, top: 0, right: 1920, bottom: 1080 }
}

/// 主显示器矩形，准星、BOSS 条、灰色蒙版都以它为准。
pub fn primary_rect() -> Rect {
    let mut info = MonitorInfo {
        size: std::mem::size_of::<MonitorInfo>() as u32,
        monitor: Rect::default(),
        work: Rect::default(),
        flags: 0,
    };
    // SAFETY: 只读取主显示器矩形
    unsafe {
        let monitor = MonitorFromPoint(Point { x: 0, y: 0 }, MONITOR_DEFAULTTONEAREST);
        if monitor != 0 && GetMonitorInfoW(monitor, &mut info) != 0 {
            return info.monitor;
        }
    }
    Rect { left: 0, top: 0, right: 1920, bottom: 1080 }
}

/// 窗口所在显示器的完整矩形，物品栏缩放按屏幕宽度计算。
pub fn monitor_rect(hwnd: Hwnd) -> Rect {
    let mut info = MonitorInfo {
        size: std::mem::size_of::<MonitorInfo>() as u32,
        monitor: Rect::default(),
        work: Rect::default(),
        flags: 0,
    };
    // SAFETY: 只读取当前显示器矩形
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor != 0 && GetMonitorInfoW(monitor, &mut info) != 0 {
            return info.monitor;
        }
    }
    Rect { left: 0, top: 0, right: 1920, bottom: 1080 }
}

pub fn key_down(key: i32) -> bool {
    // SAFETY: 只读全局键态
    unsafe { GetAsyncKeyState(key) & 0x8000u16 as i16 != 0 }
}

pub fn cursor_pos() -> Point {
    let mut point = Point::default();
    // SAFETY: 只读取光标位置
    unsafe {
        GetCursorPos(&mut point);
    }
    point
}

pub fn to_screen(hwnd: Hwnd, mut point: Point) -> Point {
    // SAFETY: 只是坐标换算
    unsafe {
        ClientToScreen(hwnd, &mut point);
    }
    point
}

pub fn track_leave(hwnd: Hwnd) {
    let mut data = TrackMouseEventData {
        size: std::mem::size_of::<TrackMouseEventData>() as u32,
        flags: TME_LEAVE,
        hwnd,
        hover: 0,
    };
    // SAFETY: 结构体字段完整，仅注册离开通知
    unsafe {
        TrackMouseEvent(&mut data);
    }
}

pub fn validate(hwnd: Hwnd) {
    // SAFETY: 只是标记重绘区域
    unsafe {
        ValidateRect(hwnd, ptr::null());
    }
}

pub fn ticks() -> u64 {
    // SAFETY: 无副作用
    unsafe { GetTickCount64() }
}
