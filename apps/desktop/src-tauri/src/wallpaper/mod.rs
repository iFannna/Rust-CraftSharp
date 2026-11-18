//! 静态壁纸：列表、下载转码、应用与另存。
//! 动态壁纸与多屏设置不在本轮范围。

mod client;
mod desktop;
mod save;
mod store;

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

pub use client::Page;

pub fn list(page: u32, kind: &str, sort: &str) -> Result<Page, String> {
    client::list(page, kind, sort)
}

/// 下载并设置壁纸，成功后清理其他缓存文件
pub fn apply(app: &AppHandle, id: &str, preview_url: &str) -> Result<String, String> {
    let path: PathBuf = store::prepare(app, id, preview_url)?;
    desktop::apply(&path)?;
    store::sweep(app, &path);
    Ok(path.to_string_lossy().into_owned())
}

pub fn export(preview_url: &str, path: &str) -> Result<(), String> {
    store::export(preview_url, path)
}

/// 以设置窗口为 owner 打开另存为对话框，必须在主线程调用
pub fn pick(app: &AppHandle, title: &str) -> Option<String> {
    let owner = app
        .get_webview_window("settings")
        .and_then(|window| window.hwnd().ok())
        .map(|handle| handle.0 as isize)
        .unwrap_or(0);
    save::pick(title, owner)
}
