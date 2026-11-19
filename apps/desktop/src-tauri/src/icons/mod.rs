//! 格子图标提取：图片文件直读，其余走 Windows Shell 图标。
//! 解码与缩放可能耗时几百毫秒，统一在后台线程完成；结果按
//! 「路径 + 修改时间 + 目标尺寸」缓存，UI 线程只做像素搬运。

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

    pub fn set_shortcut_icon(_path: &str, _icon: &str) -> bool {
        false
    }
}

pub(crate) use shell_windows::{set_shortcut_icon, shortcut_target};

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "bmp", "gif", "tiff", "webp"];
/// 格子图标最大边长，覆盖最大缩放与高 DPI
const MAX_SIZE: u32 = 128;

/// 按目标尺寸缩放后的图标，边长固定为 size，非正方形原图居中留白。
pub struct Decoded {
    pub size: u32,
    pub pixels: Vec<u8>,
}

fn decoded_cache() -> &'static Mutex<HashMap<String, Option<Arc<Decoded>>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<Arc<Decoded>>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn inflight() -> &'static Mutex<HashMap<String, Arc<OnceLock<Option<Arc<Decoded>>>>>> {
    static INFLIGHT: OnceLock<Mutex<HashMap<String, Arc<OnceLock<Option<Arc<Decoded>>>>>>> = OnceLock::new();
    INFLIGHT.get_or_init(|| Mutex::new(HashMap::new()))
}

fn url_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static URLS: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    URLS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_key(path: &str, show_target_icon: bool, size: u32) -> Option<String> {
    let path = path.trim().trim_matches('"');
    if path.is_empty() {
        return None;
    }
    Some(format!("{size}|{}|{}|{}", show_target_icon as u8, stamp_key(path), path))
}

fn stamp_key(path: &str) -> String {
    match stamp_of(path) {
        Some((len, modified)) => format!("{len}-{modified}"),
        None => "missing".to_string(),
    }
}

/// 已解码的图标，未命中返回 None；成功与失败都会缓存。
pub fn cached(path: &str, show_target_icon: bool, size: u32) -> Option<Option<Arc<Decoded>>> {
    let key = cache_key(path, show_target_icon, size.clamp(1, MAX_SIZE))?;
    let cache = decoded_cache().lock().unwrap_or_else(|error| error.into_inner());
    cache.get(&key).cloned()
}

/// 同步取图标，未缓存时在调用线程解码；UI 线程只应在命中缓存时使用。
pub fn decoded(path: &str, show_target_icon: bool, size: u32) -> Option<Arc<Decoded>> {
    let size = size.clamp(1, MAX_SIZE);
    let key = cache_key(path, show_target_icon, size)?;
    if let Ok(cache) = decoded_cache().lock() {
        if let Some(entry) = cache.get(&key) {
            return entry.clone();
        }
    }

    // 同一路径并发请求共用一次解码，后到的调用等待第一个完成
    let cell = {
        let mut map = inflight().lock().unwrap_or_else(|error| error.into_inner());
        map.entry(key.clone())
            .or_insert_with(|| Arc::new(OnceLock::new()))
            .clone()
    };
    let value = cell.get_or_init(|| build_decoded(path, show_target_icon, size)).clone();

    if let Ok(mut map) = inflight().lock() {
        map.remove(&key);
    }
    if let Ok(mut cache) = decoded_cache().lock() {
        cache.insert(key, value.clone());
    }
    value
}

/// 返回 Data URL，内容已缩放到目标尺寸；路径无效或提取失败返回 None。
pub fn data_url(path: &str, show_target_icon: bool, size: u32) -> Option<String> {
    let key = cache_key(path, show_target_icon, size.clamp(1, MAX_SIZE))?;
    if let Ok(urls) = url_cache().lock() {
        if let Some(url) = urls.get(&key) {
            return url.clone();
        }
    }

    let url = decoded(path, show_target_icon, size).map(|decoded| {
        let bytes = png::encode_rgba(decoded.size, decoded.size, &decoded.pixels);
        format!("data:image/png;base64,{}", base64::encode(&bytes))
    });

    if let Ok(mut urls) = url_cache().lock() {
        urls.insert(key, url.clone());
    }
    url
}

fn stamp_of(path: &str) -> Option<(u64, u64)> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let elapsed = modified.duration_since(UNIX_EPOCH).ok()?;
    Some((metadata.len(), elapsed.as_secs()))
}

/// 解码后按目标尺寸等比缩放并居中留白。
fn build_decoded(path: &str, show_target_icon: bool, size: u32) -> Option<Arc<Decoded>> {
    let bytes = raw_bytes(path, show_target_icon)?;
    let image = image::load_from_memory(&bytes).ok()?.to_rgba8();
    let (width, height) = (image.width(), image.height());
    if width == 0 || height == 0 {
        return None;
    }

    let ratio = (size as f32 / width as f32).min(size as f32 / height as f32);
    let target_width = ((width as f32 * ratio).round() as u32).clamp(1, size);
    let target_height = ((height as f32 * ratio).round() as u32).clamp(1, size);
    // 大幅缩小时用低成本滤波，32 像素级别看不出差别
    let filter = if width.max(height) >= size * 4 {
        image::imageops::FilterType::Triangle
    } else {
        image::imageops::FilterType::Lanczos3
    };
    let resized = image::imageops::resize(&image, target_width, target_height, filter);

    let mut out = image::RgbaImage::new(size, size);
    let x = ((size - target_width) / 2) as i64;
    let y = ((size - target_height) / 2) as i64;
    image::imageops::replace(&mut out, &resized, x, y);

    Some(Arc::new(Decoded { size, pixels: out.into_raw() }))
}

/// 图标原始编码字节：图片直接读文件，其余类型走 Shell 提取。
fn raw_bytes(path: &str, show_target_icon: bool) -> Option<Vec<u8>> {
    let path = path.trim().trim_matches('"');
    if path.is_empty() {
        return None;
    }

    let metadata = fs::metadata(path).ok()?;
    let is_dir = metadata.is_dir();
    let extension = extension_of(path);

    if !is_dir && IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        if let Ok(bytes) = fs::read(path) {
            if !bytes.is_empty() {
                return Some(bytes);
            }
        }
    }

    if !is_dir && extension == "lnk" && show_target_icon {
        if let Some(target) = shell_windows::shortcut_target(path) {
            if fs::metadata(&target).is_ok() {
                if let Some(icon) = shell_icon_bytes(&target).or_else(|| shell_icon_bytes(path)) {
                    return Some(icon);
                }
            }
        }
    }

    shell_icon_bytes(path)
}

fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn shell_icon_bytes(path: &str) -> Option<Vec<u8>> {
    let (width, height, rgba) = shell_windows::icon_rgba(path)?;
    Some(png::encode_rgba(width, height, &rgba))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 非正方形图片按等比缩放居中，输出固定方块；第二次直接命中缓存。
    #[test]
    fn decodes_image_to_square_and_caches() {
        let path = std::env::temp_dir().join("craftsharp-icon-test.png");
        let mut image = image::RgbaImage::new(64, 32);
        for pixel in image.pixels_mut() {
            *pixel = image::Rgba([255, 0, 0, 255]);
        }
        image.save(&path).unwrap();
        let path = path.to_string_lossy().to_string();

        let decoded = decoded(&path, false, 48).expect("图标解码失败");
        assert_eq!(decoded.size, 48);
        assert_eq!(decoded.pixels.len(), 48 * 48 * 4);
        let center = ((24 * 48 + 24) * 4) as usize;
        assert_eq!(&decoded.pixels[center..center + 4], &[255, 0, 0, 255]);

        let url = data_url(&path, false, 48).expect("图标 Data URL 生成失败");
        assert!(url.starts_with("data:image/png;base64,"));
        assert!(cached(&path, false, 48).is_some());
    }
}
