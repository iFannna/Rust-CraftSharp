//! 平台能力入口。当前只实现 Windows，其余平台返回不支持。

#[cfg(windows)]
mod windows_api;
#[cfg(not(windows))]
mod windows_api {
    pub fn open(_path: &str) -> Result<(), String> {
        Err("当前平台未实现".into())
    }

    pub fn reveal(_path: &str) -> Result<(), String> {
        Err("当前平台未实现".into())
    }

    pub fn run_as_admin(_path: &str) -> Result<(), String> {
        Err("当前平台未实现".into())
    }

    pub fn exists(_path: &str) -> bool {
        false
    }

    pub fn rename(_from: &str, _to: &str) -> Result<(), String> {
        Err("当前平台未实现".into())
    }

    pub fn copy_text(_text: &str) -> Result<(), String> {
        Err("当前平台未实现".into())
    }

    pub fn read_file_paths() -> Vec<String> {
        Vec::new()
    }
}

#[cfg(windows)]
mod window_fx;
#[cfg(not(windows))]
mod window_fx {
    pub fn disable_transitions(_hwnd: isize) {}
    pub fn enable_transitions(_hwnd: isize) {}
    pub fn animate_window(_hwnd: isize, _visible: bool) -> bool {
        false
    }
    pub fn install_caption_hook(_hwnd: isize, _app: tauri::AppHandle, _label: String) {}
}

#[cfg(target_os = "linux")]
mod window_x11;
#[cfg(target_os = "linux")]
pub use window_x11::raise;
#[cfg(not(target_os = "linux"))]
pub fn raise(_: &tauri::WebviewWindow) {}

pub use windows_api::*;
pub use window_fx::*;
