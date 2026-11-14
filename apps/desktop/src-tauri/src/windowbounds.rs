//! 一次性设置窗口位置与尺寸。
//!
//! HUD 的 WebView 子窗口固定为最大内容尺寸，窗口缩放只是裁剪，
//! 所以这里只改窗口矩形，不再触碰子窗口，避免 WebView 重排前的空白帧。

#![allow(non_snake_case)]

#[cfg(windows)]
mod imp {
    use tauri::WebviewWindow;

    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_NOOWNERZORDER: u32 = 0x0200;

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
    }

    pub fn set(window: &WebviewWindow, x: i32, y: i32, width: i32, height: i32) -> bool {
        let Ok(raw) = window.hwnd() else {
            return false;
        };
        let window = raw.0 as isize;

        let mut before = Rect { left: 0, top: 0, right: 0, bottom: 0 };
        // SAFETY: 只查询当前窗口矩形
        if unsafe { GetWindowRect(window, &mut before) } == 0 {
            return false;
        }
        if before.left == x
            && before.top == y
            && before.right - before.left == width
            && before.bottom - before.top == height
        {
            return true;
        }

        // SAFETY: 只改位置与尺寸，层级和激活状态保持不变
        unsafe {
            SetWindowPos(
                window,
                0,
                x,
                y,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            ) != 0
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::WebviewWindow;

    pub fn set(_window: &WebviewWindow, _x: i32, _y: i32, _width: i32, _height: i32) -> bool {
        false
    }
}

pub use imp::set;
