//! 自绘窗口拖动：按物理像素跟随系统光标，避免 DPI 取整带来的抖动。

#![allow(non_snake_case)]

#[cfg(windows)]
mod imp {
    use std::thread;
    use std::time::Duration;

    use tauri::WebviewWindow;

    const VK_LBUTTON: i32 = 0x01;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const POLL_INTERVAL: Duration = Duration::from_millis(4);

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(point: *mut Point) -> i32;
        fn GetWindowRect(window: isize, rect: *mut Rect) -> i32;
        fn SetWindowPos(window: isize, insert_after: isize, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
        fn GetAsyncKeyState(key: i32) -> i16;
    }

    pub fn drag(window: &WebviewWindow) -> Option<(i32, i32)> {
        let Ok(raw) = window.hwnd() else {
            return None;
        };
        let hwnd = raw.0 as isize;

        let mut start = Point { x: 0, y: 0 };
        let mut origin = Rect { left: 0, top: 0, right: 0, bottom: 0 };
        // SAFETY: 只查询当前光标与窗口矩形
        unsafe {
            if GetCursorPos(&mut start) == 0 || GetWindowRect(hwnd, &mut origin) == 0 {
                return None;
            }
        }

        // 松开左键即结束；每 4ms 按光标物理位移移动窗口，不受取整影响
        loop {
            if unsafe { GetAsyncKeyState(VK_LBUTTON) } >= 0 {
                break;
            }

            let mut cursor = Point { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut cursor) } != 0 {
                let x = origin.left + cursor.x - start.x;
                let y = origin.top + cursor.y - start.y;
                // SAFETY: 只改窗口位置，尺寸与层级保持不变
                unsafe {
                    SetWindowPos(hwnd, 0, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                }
            }

            thread::sleep(POLL_INTERVAL);
        }

        let mut end = Rect { left: 0, top: 0, right: 0, bottom: 0 };
        // SAFETY: 同上，读取拖动结束后的窗口位置
        unsafe {
            if GetWindowRect(hwnd, &mut end) == 0 {
                return None;
            }
        }
        Some((end.left, end.top))
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::WebviewWindow;

    pub fn drag(_window: &WebviewWindow) -> Option<(i32, i32)> {
        None
    }
}

pub use imp::drag;
