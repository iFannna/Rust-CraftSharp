//! 动态壁纸：Windows 与 Linux 都使用每屏常驻的原生渲染窗口。

#[cfg(windows)]
mod renderer;
#[cfg(windows)]
mod windows;
#[cfg(target_os = "linux")]
mod linux;

#[cfg(windows)]
pub use windows::*;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(not(any(windows, target_os = "linux")))]
mod unsupported {
    use std::path::PathBuf;

    use tauri::AppHandle;

    use super::super::store::Transform;

    pub use super::super::saved::Saved;

    pub fn apply_monitors(_: &AppHandle, _: &[(String, PathBuf)]) -> Result<(), String> {
        Err("当前平台暂不支持动态壁纸".into())
    }

    pub fn apply_span(_: &AppHandle, _: &PathBuf, _: Transform) -> Result<(), String> {
        Err("当前平台暂不支持动态壁纸".into())
    }

    pub fn stop_all() {}

    pub fn remember(_: &AppHandle, _: &[Saved]) {}

    pub fn forget(_: &AppHandle) {}

    pub fn restore(_: &AppHandle) {}

    pub fn stop_devices(_: &[String]) {}
}

#[cfg(not(any(windows, target_os = "linux")))]
pub use unsupported::*;
