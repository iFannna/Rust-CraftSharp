//! 一次性设置窗口位置与尺寸。
//!
//! 透明窗口重排时，DWM 会在窗口矩形和 WebView 子窗口之间合成出没有内容的帧。
//! 这里把重排整段过程放到 DWM cloak 里完成，并同步调整 WebView 子窗口与已有区域，
//! 使整次变化只有一帧，不出现空洞或错位。

#![allow(non_snake_case)]

#[cfg(windows)]
mod imp {
    use tauri::WebviewWindow;

    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOREDRAW: u32 = 0x0008;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_NOCOPYBITS: u32 = 0x0100;
    const SWP_NOOWNERZORDER: u32 = 0x0200;
    const GW_CHILD: u32 = 5;
    const GW_HWNDNEXT: u32 = 2;
    const RGN_ERROR: i32 = 0;
    const DWMWA_CLOAK: u32 = 13;

    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(window: isize, insert_after: isize, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
        fn GetWindowRect(window: isize, rect: *mut Rect) -> i32;
        fn GetWindowRgn(window: isize, region: isize) -> i32;
        fn SetWindowRgn(window: isize, region: isize, redraw: i32) -> i32;
        fn GetWindow(window: isize, command: u32) -> isize;
        fn GetClassNameW(window: isize, buffer: *mut u16, capacity: i32) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> isize;
        fn OffsetRgn(region: isize, x: i32, y: i32) -> i32;
        fn DeleteObject(object: isize) -> i32;
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(window: isize, attribute: u32, value: *const i32, size: u32) -> i32;
    }

    /// 短暂隐藏 DWM 合成，让重排的中间状态不参与合成。
    fn cloak(window: isize, enabled: bool) {
        let value: i32 = i32::from(enabled);
        // SAFETY: 只写一个 BOOL 属性
        unsafe {
            DwmSetWindowAttribute(window, DWMWA_CLOAK, &value, std::mem::size_of::<i32>() as u32);
        }
    }

    /// WebView 子窗口由 wry 异步调整，这里同步改一次，避免窗口矩形先变、内容后到的空洞帧。
    fn resize_children(window: isize, width: i32, height: i32) {
        let mut buffer = [0u16; 64];
        // SAFETY: 遍历子窗口并同步设置尺寸
        unsafe {
            let mut child = GetWindow(window, GW_CHILD);
            while child != 0 {
                let length = GetClassNameW(child, buffer.as_mut_ptr(), buffer.len() as i32);
                let length = usize::try_from(length).unwrap_or(0).min(buffer.len());
                if String::from_utf16_lossy(&buffer[..length]).starts_with("Chrome_WidgetWin") {
                    SetWindowPos(
                        child,
                        0,
                        0,
                        0,
                        width,
                        height,
                        SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                    );
                }
                child = GetWindow(child, GW_HWNDNEXT);
            }
        }
    }

    /// 窗口区域是窗口坐标，内容随窗口平移后需要跟着平移，
    /// 否则重排到前端重提区域之间会有一帧裁错位置。
    fn shift_region(window: isize, dx: i32, dy: i32) {
        if dx == 0 && dy == 0 {
            return;
        }
        // SAFETY: 只复制、平移并重设当前窗口区域
        unsafe {
            let region = CreateRectRgn(0, 0, 0, 0);
            if region == 0 {
                return;
            }
            if GetWindowRgn(window, region) == RGN_ERROR {
                DeleteObject(region);
                return;
            }
            OffsetRgn(region, dx, dy);
            if SetWindowRgn(window, region, 0) == 0 {
                DeleteObject(region);
            }
        }
    }

    pub fn set(window: &WebviewWindow, x: i32, y: i32, width: i32, height: i32, dx: i32, dy: i32) -> bool {
        let Ok(raw) = window.hwnd() else {
            return false;
        };
        let window = raw.0 as isize;

        let mut before = Rect { left: 0, top: 0, right: 0, bottom: 0 };
        // SAFETY: 只查询当前窗口矩形
        if unsafe { GetWindowRect(window, &mut before) } == 0 {
            return false;
        }
        let size_changed = before.right - before.left != width || before.bottom - before.top != height;
        if !size_changed && before.left == x && before.top == y {
            return true;
        }

        cloak(window, true);

        // SAFETY: 只改位置与尺寸，层级和激活状态保持不变；
        // 不重绘、不拷贝旧内容，窗口内容由 WebView 自己按新尺寸绘制
        let moved = unsafe {
            SetWindowPos(
                window,
                0,
                x,
                y,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOREDRAW | SWP_NOCOPYBITS,
            ) != 0
        };

        if moved {
            shift_region(window, dx, dy);
            if size_changed {
                resize_children(window, width, height);
            }
        }

        cloak(window, false);
        moved
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::WebviewWindow;

    pub fn set(
        _window: &WebviewWindow,
        _x: i32,
        _y: i32,
        _width: i32,
        _height: i32,
        _dx: i32,
        _dy: i32,
    ) -> bool {
        false
    }
}

pub use imp::set;
