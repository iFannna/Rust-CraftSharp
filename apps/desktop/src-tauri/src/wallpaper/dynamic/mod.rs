//! 动态壁纸：Windows 原生解码渲染，Linux X11 常驻视频窗口。

use serde::Serialize;

/// 物理像素矩形，页面按自身缩放换算成 CSS 尺寸
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

/// 视频窗口的播放参数，创建时拉取、换源时推送
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoState {
    pub url: String,
    pub poster: String,
    pub rect: Rect,
    pub virtual_rect: Option<Rect>,
    pub zoom: f64,
    pub offset_x: f64,
    pub offset_y: f64,
}

#[cfg(not(target_os = "linux"))]
pub fn state(_: &str) -> Option<VideoState> {
    None
}

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

    pub fn apply_monitors(_: &[(String, PathBuf)]) -> Result<(), String> {
        Err("当前平台暂不支持动态壁纸".into())
    }

    pub fn apply_span(_: &PathBuf, _: Transform) -> Result<(), String> {
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
