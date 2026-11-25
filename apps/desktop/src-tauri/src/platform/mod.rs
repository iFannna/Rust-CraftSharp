//! 平台能力入口。当前只实现 Windows，其余平台返回不支持。

#[cfg(windows)]
mod windows_api;
#[cfg(not(windows))]
mod windows_api {
    use std::path::Path;
    use std::process::Command;

    fn launch(target: &Path) -> Result<(), String> {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn open(path: &str) -> Result<(), String> {
        launch(Path::new(path))
    }

    /// 在文件管理器里打开所在目录
    pub fn reveal(path: &str) -> Result<(), String> {
        let target = Path::new(path);
        launch(target.parent().unwrap_or(target))
    }

    pub fn run_as_admin(_path: &str) -> Result<(), String> {
        Err("当前平台未实现".into())
    }

    pub fn exists(path: &str) -> bool {
        Path::new(path).exists()
    }

    pub fn rename(from: &str, to: &str) -> Result<(), String> {
        std::fs::rename(from, to).map_err(|error| error.to_string())
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

/// 独立弹窗叠在同层浮层之上，菜单等窗口显示后调用
#[cfg(target_os = "linux")]
pub fn restack_top(window: &tauri::WebviewWindow) {
    use gtk::glib::Cast;
    use gtk::prelude::*;

    let Some(gtk_window) = window.gtk_window().ok() else { return };
    // 与物品栏同为菜单类窗口，才能落在同一个弹层层里再按顺序重排
    gtk_window.set_type_hint(gtk::gdk::WindowTypeHint::Menu);
    let Some(gdk_window) = gtk_window.window() else { return };
    if let Ok(x11) = gdk_window.downcast::<gdkx11::X11Window>() {
        crate::hud::host_x11::restack_top(x11.xid() as u32);
    }
}
#[cfg(not(target_os = "linux"))]
pub fn restack_top(_: &tauri::WebviewWindow) {}

pub use windows_api::*;
pub use window_fx::*;
