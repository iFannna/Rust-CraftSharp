//! Linux 文件图标：沿用桌面主题，按 MIME 给出与文件管理器一致的图标。
//! 文件夹取系统文件夹图标，未知类型退到通用文件图标。

mod ffi;
mod theme;

use std::path::Path;

/// 与格子图标最大尺寸一致，后续缩放统一在 icons 模块完成。
const SIZE: u32 = 128;

pub fn icon_rgba(path: &str) -> Option<(u32, u32, Vec<u8>)> {
    let path = Path::new(path);
    let mut names = ffi::icon_names(path);
    names.push(if path.is_dir() { "folder".to_string() } else { "text-x-generic".to_string() });

    for name in &names {
        let Some(file) = theme::find(name) else { continue };
        if let Some(image) = ffi::rasterize(&file, SIZE) {
            return Some(image);
        }
    }
    None
}

pub fn shortcut_target(_: &str) -> Option<String> {
    None
}
