//! 格子图标提取：图片文件直读，其余走 Windows Shell 图标。

mod base64;
mod png;

#[cfg(windows)]
mod shell_windows;
#[cfg(not(windows))]
mod shell_windows {
    pub fn icon_rgba(_path: &str) -> Option<(u32, u32, Vec<u8>)> {
        None
    }

    pub fn shortcut_target(_path: &str) -> Option<String> {
        None
    }
}

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

/// 与原 WPF IconExtractor 保持一致的图片扩展名列表
const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "bmp", "gif", "tiff", "webp"];

struct CacheEntry {
    stamp: Option<(u64, u64)>,
    data_url: Option<String>,
}

fn cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 返回格子图标 Data URL；路径无效或提取失败返回 None。
pub fn slot_icon(path: &str, show_target_icon: bool) -> Option<String> {
    let path = path.trim().trim_matches('"');
    if path.is_empty() {
        return None;
    }

    let stamp = stamp_of(path);
    let key = format!("{}{}", if show_target_icon { '\u{1}' } else { '\u{0}' }, path);

    if let Ok(cache) = cache().lock() {
        if let Some(entry) = cache.get(&key) {
            if entry.stamp == stamp {
                return entry.data_url.clone();
            }
        }
    }

    let data_url = build(path, show_target_icon);

    if let Ok(mut cache) = cache().lock() {
        cache.insert(key, CacheEntry { stamp, data_url: data_url.clone() });
    }

    data_url
}

fn stamp_of(path: &str) -> Option<(u64, u64)> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let elapsed = modified.duration_since(UNIX_EPOCH).ok()?;
    Some((metadata.len(), elapsed.as_secs()))
}

fn build(path: &str, show_target_icon: bool) -> Option<String> {
    let (mime, bytes) = build_bytes(path, show_target_icon)?;
    Some(format!("data:{};base64,{}", mime, base64::encode(&bytes)))
}

/// 图标原始编码字节，原生 HUD 直接解码绘制，不经过 Data URL。
pub fn slot_icon_bytes(path: &str, show_target_icon: bool) -> Option<Vec<u8>> {
    let path = path.trim().trim_matches('"');
    if path.is_empty() {
        return None;
    }
    build_bytes(path, show_target_icon).map(|(_, bytes)| bytes)
}

fn build_bytes(path: &str, show_target_icon: bool) -> Option<(&'static str, Vec<u8>)> {
    let metadata = fs::metadata(path).ok()?;
    let is_dir = metadata.is_dir();
    let extension = extension_of(path);

    if !is_dir && IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        if let Some(mime) = mime_of(&extension) {
            if let Ok(bytes) = fs::read(path) {
                if !bytes.is_empty() {
                    return Some((mime, bytes));
                }
            }
        }
    }

    if !is_dir && extension == "lnk" && show_target_icon {
        if let Some(target) = shell_windows::shortcut_target(path) {
            if fs::metadata(&target).is_ok() {
                if let Some(icon) = shell_icon_bytes(&target).or_else(|| shell_icon_bytes(path)) {
                    return Some(("image/png", icon));
                }
            }
        }
    }

    shell_icon_bytes(path).map(|bytes| ("image/png", bytes))
}

fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn mime_of(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "bmp" => Some("image/bmp"),
        "gif" => Some("image/gif"),
        "tiff" => Some("image/tiff"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn shell_icon_bytes(path: &str) -> Option<Vec<u8>> {
    let (width, height, rgba) = shell_windows::icon_rgba(path)?;
    Some(png::encode_rgba(width, height, &rgba))
}
