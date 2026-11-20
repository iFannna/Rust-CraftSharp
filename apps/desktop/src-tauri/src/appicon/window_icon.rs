//! 窗口图标槽位：任务栏在 Win11 上读 ICON_SMALL2，未设置时会回退到程序文件图标。
//! 已存在的任务栏按钮不会随 WM_SETICON 重绘，需要删掉重建才会读取新图标。

use std::sync::Mutex;
use std::time::Duration;

use tauri::WebviewWindow;
use windows::core::GUID;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::ITaskbarList;
use windows::Win32::UI::WindowsAndMessaging::{IsWindowVisible, WM_SETICON};

use super::ico::Entry;

const ICON_SMALL: usize = 0;
const ICON_BIG: usize = 1;
const ICON_SMALL2: usize = 2;

/// 只有设置窗口常驻任务栏；其余窗口要么隐藏，要么是短命的对话框
const TASKBAR_WINDOW: &str = "settings";
/// 按钮删除后等 Explorer 刷新图标缓存再重新加回
const READD_DELAY: Duration = Duration::from_millis(150);
/// RPC_E_CHANGED_MODE，调用线程已在其他单元初始化
const RPC_E_CHANGED_MODE: i32 = 0x8001_0106u32 as i32;

/// {56FDF344-FD6D-11D0-958A-006097C9A090}
const CLSID_TASKBAR_LIST: GUID =
    GUID::from_values(0x56FDF344, 0xFD6D, 0x11D0, [0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90]);

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

/// 任务栏按钮刷新，借 DeleteTab/AddTab 让 Explorer 重新读取窗口图标
struct Taskbar {
    list: ITaskbarList,
    initialized: bool,
}

impl Taskbar {
    fn new() -> Option<Self> {
        unsafe {
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let initialized = hr.0 >= 0;
            if !initialized && hr.0 != RPC_E_CHANGED_MODE {
                return None;
            }
            let list: windows::core::Result<ITaskbarList> =
                CoCreateInstance(&CLSID_TASKBAR_LIST, None, CLSCTX_INPROC_SERVER);
            let list = match list {
                Ok(list) if list.HrInit().is_ok() => list,
                _ => {
                    if initialized {
                        CoUninitialize();
                    }
                    return None;
                }
            };
            Some(Self { list, initialized })
        }
    }

    fn remove(&self, hwnd: HWND) {
        unsafe {
            let _ = self.list.DeleteTab(hwnd);
        }
    }

    fn add(&self, hwnd: HWND) {
        unsafe {
            let _ = self.list.AddTab(hwnd);
        }
    }
}

impl Drop for Taskbar {
    fn drop(&mut self) {
        if self.initialized {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

fn set_slots(hwnd: HWND, icon: isize) {
    unsafe {
        let raw = hwnd.0 as isize;
        SendMessageW(raw, WM_SETICON, ICON_SMALL, icon);
        SendMessageW(raw, WM_SETICON, ICON_BIG, icon);
        SendMessageW(raw, WM_SETICON, ICON_SMALL2, icon);
    }
}

/// 删掉任务栏按钮，延迟加回，给 Explorer 留出刷新图标缓存的时间
fn rebuild_taskbar(hwnd: HWND) {
    if unsafe { !IsWindowVisible(hwnd).as_bool() } {
        return;
    }
    if let Some(taskbar) = Taskbar::new() {
        taskbar.remove(hwnd);
    }
    let raw = hwnd.0 as isize;
    std::thread::spawn(move || {
        std::thread::sleep(READD_DELAY);
        let hwnd = HWND(raw as *mut _);
        if let Some(taskbar) = Taskbar::new() {
            taskbar.add(hwnd);
        }
    });
}

fn apply_one(window: &WebviewWindow, icon: isize, rebuild: bool) {
    let Ok(hwnd) = window.hwnd() else { return };
    set_slots(hwnd, icon);
    if rebuild && window.label() == TASKBAR_WINDOW {
        rebuild_taskbar(hwnd);
    }
}

/// 用 32 像素条目创建 HICON，写进所有窗口，并换下上一个句柄
pub fn apply<'a>(
    windows: impl Iterator<Item = &'a WebviewWindow>,
    entries: &[Entry],
    rebuild_taskbar: bool,
) -> bool {
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
        apply_one(window, icon, rebuild_taskbar);
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
    apply_one(window, icon, false);
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
