//! 窗口图标槽位：任务栏在 Win11 上读 ICON_SMALL2，未设置时会回退到程序文件图标。

use std::sync::Mutex;

use tauri::WebviewWindow;

use super::ico::Entry;

const WM_SETICON: u32 = 0x0080;
const ICON_SMALL: usize = 0;
const ICON_BIG: usize = 1;
const ICON_SMALL2: usize = 2;

static CURRENT: Mutex<isize> = Mutex::new(0);

#[link(name = "user32")]
extern "system" {
    fn SendMessageW(hwnd: isize, message: u32, wparam: usize, lparam: isize) -> isize;
    fn CreateIconFromResourceEx(
        data: *const u8,
        size: u32,
        icon: i32,
        version: u32,
        width: i32,
        height: i32,
        flags: u32,
    ) -> isize;
    fn DestroyIcon(icon: isize) -> i32;
}

fn set(window: &WebviewWindow, icon: isize) {
    let Ok(hwnd) = window.hwnd() else { return };
    let hwnd = hwnd.0 as isize;
    unsafe {
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL, icon);
        SendMessageW(hwnd, WM_SETICON, ICON_BIG, icon);
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL2, icon);
    }
}

/// 用 32 像素条目创建 HICON，写进所有窗口，并换下上一个句柄
pub fn apply<'a>(windows: impl Iterator<Item = &'a WebviewWindow>, entries: &[Entry]) -> bool {
    let Some(entry) = entries.iter().find(|entry| entry.width == 32).or_else(|| entries.first()) else {
        return false;
    };
    let icon = unsafe {
        CreateIconFromResourceEx(entry.data.as_ptr(), entry.data.len() as u32, 1, 0x0003_0000, 0, 0, 0)
    };
    if icon == 0 {
        return false;
    }

    let mut current = CURRENT.lock().unwrap_or_else(|poison| poison.into_inner());
    for window in windows {
        set(window, icon);
    }
    let previous = std::mem::replace(&mut *current, icon);
    if previous != 0 {
        unsafe {
            DestroyIcon(previous);
        }
    }
    true
}

/// 新窗口挂到当前图标上；还没设置过时返回 false，由调用方使用默认图标
pub fn apply_to_window(window: &WebviewWindow) -> bool {
    let icon = *CURRENT.lock().unwrap_or_else(|poison| poison.into_inner());
    if icon == 0 {
        return false;
    }
    set(window, icon);
    true
}

#[cfg(test)]
mod tests {
    use super::super::ico;
    use super::CreateIconFromResourceEx;

    #[test]
    fn creates_icon_from_generated_entry() {
        let source = image::RgbaImage::from_pixel(32, 32, image::Rgba([30, 160, 90, 255]));
        let entries = ico::entries(&source).unwrap();
        let entry = entries.iter().find(|entry| entry.width == 32).unwrap();
        let icon = unsafe {
            CreateIconFromResourceEx(entry.data.as_ptr(), entry.data.len() as u32, 1, 0x0003_0000, 0, 0, 0)
        };
        assert_ne!(icon, 0, "无法从 PNG 条目创建 HICON");
        unsafe {
            super::DestroyIcon(icon);
        }
    }
}
