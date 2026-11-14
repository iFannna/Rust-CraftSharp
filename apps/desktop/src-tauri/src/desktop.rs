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

    pub fn toggle() -> Result<(), String> {
        let progman = wide("Progman");
        let def_view = wide("SHELLDLL_DefView");
        let list_view = wide("SysListView32");

        // SAFETY: 只查找系统窗口并切换其可见性
        unsafe {
            let shell = FindWindowW(progman.as_ptr(), std::ptr::null());
            if shell == 0 {
                return Err("找不到桌面窗口".into());
            }
            let view = FindWindowExW(shell, 0, def_view.as_ptr(), std::ptr::null());
            if view == 0 {
                return Err("找不到桌面图标宿主".into());
            }
            let icons = FindWindowExW(view, 0, list_view.as_ptr(), std::ptr::null());
            if icons == 0 {
                return Err("找不到桌面图标列表".into());
            }
            let visible = IsWindowVisible(icons) != 0;
            ShowWindow(icons, if visible { SW_HIDE } else { SW_SHOW });
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn toggle() -> Result<(), String> {
        Err("当前平台不支持桌面图标切换".into())
    }
}

pub use imp::toggle;
