//! 桌面图标显隐，对应原版 Ctrl+Alt+D 快捷键。

#[cfg(windows)]
mod imp {
    const SW_HIDE: i32 = 0;
    const SW_SHOW: i32 = 5;

    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(class: *const u16, title: *const u16) -> isize;
        fn FindWindowExW(parent: isize, after: isize, class: *const u16, title: *const u16) -> isize;
        fn IsWindowVisible(window: isize) -> i32;
        fn ShowWindow(window: isize, command: i32) -> i32;
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 查找桌面图标列表窗口。
    fn icons_window() -> Option<isize> {
        let progman = wide("Progman");
        let def_view = wide("SHELLDLL_DefView");
        let list_view = wide("SysListView32");

        // SAFETY: 只查找系统窗口
        unsafe {
            let shell = FindWindowW(progman.as_ptr(), std::ptr::null());
            if shell == 0 {
                return None;
            }
            let view = FindWindowExW(shell, 0, def_view.as_ptr(), std::ptr::null());
            if view == 0 {
                return None;
            }
            let icons = FindWindowExW(view, 0, list_view.as_ptr(), std::ptr::null());
            if icons == 0 {
                return None;
            }
            Some(icons)
        }
    }

    pub fn toggle() -> Result<(), String> {
        // SAFETY: 只切换系统桌面图标窗口的可见性
        unsafe {
            let icons = icons_window().ok_or_else(|| "找不到桌面图标列表".to_string())?;
            let visible = IsWindowVisible(icons) != 0;
            ShowWindow(icons, if visible { SW_HIDE } else { SW_SHOW });
        }
        Ok(())
    }

    /// 桌面图标当前是否可见；查不到时按可见处理，避免菜单文案误判。
    pub fn is_visible() -> bool {
        // SAFETY: 只读取窗口可见性
        unsafe {
            icons_window()
                .map(|icons| IsWindowVisible(icons) != 0)
                .unwrap_or(true)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn toggle() -> Result<(), String> {
        Err("当前平台不支持桌面图标切换".into())
    }

    pub fn is_visible() -> bool {
        true
    }
}

pub use imp::{is_visible, toggle};
