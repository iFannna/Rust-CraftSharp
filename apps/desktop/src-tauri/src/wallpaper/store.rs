//! 壁纸下载、转码、缓存与拼接裁片。统一输出 JPEG，兼容 IDesktopWallpaper。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::AppHandle;

use super::desktop::MonitorInfo;
use super::{auth, client, storage};

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    #[serde(default = "unit_zoom")]
    pub zoom: f64,
    #[serde(default)]
    pub offset_x: f64,
    #[serde(default)]
    pub offset_y: f64,
}

fn unit_zoom() -> f64 {
    1.0
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            zoom: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
        }
    }
}

fn root(app: &AppHandle) -> PathBuf {
    storage::root(app)
}

fn post_url(id: &str) -> String {
    if auth::logged_in() {
        client::original_url(id)
    } else {
        client::preview_url(id)
    }
}

fn file_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("壁纸标识无效".into());
    }
    Ok(id)
}

/// 下载静态壁纸并转成 JPEG；登录后取原图，未登录用 1920 预览
pub fn prepare(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let id = file_id(id)?;
    let name = format!("{id}-{}.jpg", if auth::logged_in() { "full" } else { "preview" });
    let dir = root(app);
    fs::create_dir_all(&dir).map_err(|error| format!("创建壁纸目录失败：{error}"))?;

    let target = dir.join(&name);
    if target.metadata().is_ok_and(|meta| meta.len() > 0) {
        return Ok(target);
    }

    let bytes = download_with_retry(&post_url(id))?;
    let jpeg = to_jpeg(&bytes)?;
    // 下载耗时较长，期间可能已切换存储目录
    let dir = root(app);
    fs::create_dir_all(&dir).map_err(|error| format!("创建壁纸目录失败：{error}"))?;
    let target = dir.join(&name);
    write_atomic(&target, &jpeg)?;
    Ok(target)
}

/// 动态壁纸视频，必须登录后取原文件
pub fn prepare_video(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !auth::logged_in() {
        return Err("动态壁纸需要先登录 mcblock.top".into());
    }
    let id = file_id(id)?;
    let dir = root(app).join("videos");
    fs::create_dir_all(&dir).map_err(|error| format!("创建视频目录失败：{error}"))?;

    let target = dir.join(format!("{id}.mp4"));
    if target.metadata().is_ok_and(|meta| meta.len() > 0) {
        return Ok(target);
    }
    let bytes = download_with_retry(&client::original_url(id))?;
    let dir = root(app).join("videos");
    fs::create_dir_all(&dir).map_err(|error| format!("创建视频目录失败：{error}"))?;
    let target = dir.join(format!("{id}.mp4"));
    write_atomic(&target, &bytes)?;
    Ok(target)
}

/// 按显示器裁出拼接块，返回设备路径与图片路径；缓存键包含拓扑和变换
pub fn span_crops(
    app: &AppHandle,
    id: &str,
    monitors: &[MonitorInfo],
    transform: Transform,
) -> Result<Vec<(String, PathBuf)>, String> {
    if monitors.is_empty() {
        return Err("没有可用显示器".into());
    }
    let source = prepare(app, id)?;
    let id = file_id(id)?;
    let dir = root(app).join("span").join(id);
    fs::create_dir_all(&dir).map_err(|error| format!("创建拼接目录失败：{error}"))?;

    let transform = Transform {
        zoom: transform.zoom.clamp(1.0, 3.0),
        offset_x: transform.offset_x.clamp(-1.0, 1.0),
        offset_y: transform.offset_y.clamp(-1.0, 1.0),
    };
    let fingerprint = format!(
        "{}|{}|{:.4}|{:.4}|{:.4}",
        topology(monitors),
        if auth::logged_in() { "full" } else { "preview" },
        transform.zoom,
        transform.offset_x,
        transform.offset_y
    );

    let targets: Vec<(String, PathBuf)> = monitors
        .iter()
        .map(|monitor| {
            (
                monitor.device_path.clone(),
                dir.join(format!("{}.jpg", sanitize(&monitor.device_path))),
            )
        })
        .collect();
    let manifest = dir.join("manifest");
    if fs::read_to_string(&manifest).is_ok_and(|value| value.trim() == fingerprint)
        && targets.iter().all(|(_, path)| path.exists())
    {
        return Ok(targets);
    }

    let image = image::open(&source).map_err(|_| "拼接源图无法解析".to_string())?;
    let (img_w, img_h) = (image.width() as f64, image.height() as f64);
    let (virtual_x, virtual_y, virtual_w, virtual_h) = virtual_bounds(monitors);
    let rect = source_rect(img_w, img_h, virtual_w, virtual_h, transform);
    let scale = virtual_w / rect.2;
    if scale <= 0.0 {
        return Err("拼接缩放无效".into());
    }

    for (monitor, (_, target)) in monitors.iter().zip(&targets) {
        let rx = (monitor.left - virtual_x) as f64;
        let ry = (monitor.top - virtual_y) as f64;
        let rw = monitor.width().max(1) as f64;
        let rh = monitor.height().max(1) as f64;

        let crop_x = (rect.0 + rx / scale).round().max(0.0) as u32;
        let crop_y = (rect.1 + ry / scale).round().max(0.0) as u32;
        let crop_w = (rw / scale).round().max(1.0) as u32;
        let crop_h = (rh / scale).round().max(1.0) as u32;
        let crop_w = crop_w.min(image.width().saturating_sub(crop_x)).max(1);
        let crop_h = crop_h.min(image.height().saturating_sub(crop_y)).max(1);

        let crop = image.crop_imm(crop_x, crop_y, crop_w, crop_h);
        let resized = crop.resize_exact(
            monitor.width().max(1) as u32,
            monitor.height().max(1) as u32,
            image::imageops::FilterType::Lanczos3,
        );
        let jpeg = to_jpeg_from(&resized)?;
        write_atomic(target, &jpeg)?;
    }

    fs::write(&manifest, fingerprint).map_err(|error| format!("写入拼接清单失败：{error}"))?;
    sweep_span(app, id);
    Ok(targets)
}

/// 清理其他壁纸的拼接目录
pub fn sweep_span(app: &AppHandle, keep: &str) {
    let dir = root(app);
    let Ok(entries) = fs::read_dir(dir.join("span")) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy() == keep {
            continue;
        }
        let _ = fs::remove_dir_all(entry.path());
    }
}

/// 只清理由本应用命名的缓存文件，避免影响目录内的其他内容
pub fn sweep(app: &AppHandle, keeps: &[PathBuf]) {
    let dir = root(app);
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() || keeps.iter().any(|keep| keep == &path) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with("-full.jpg") || name.ends_with("-preview.jpg") {
            let _ = fs::remove_file(path);
        }
    }
}

/// 另存到用户选择的位置，扩展名统一为 jpg
pub fn export(id: &str, path: &str) -> Result<(), String> {
    let bytes = download_with_retry(&post_url(id))?;
    let jpeg = to_jpeg(&bytes)?;

    let mut target = PathBuf::from(path);
    let is_jpeg = target
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("jpg") || ext.eq_ignore_ascii_case("jpeg"));
    if !is_jpeg {
        target.set_extension("jpg");
        if target != PathBuf::from(path) && target.exists() {
            return Err("同名文件已存在".into());
        }
    }
    fs::write(&target, jpeg).map_err(|error| format!("保存失败：{error}"))
}

pub fn safe_name(title: &str) -> String {
    let name: String = title
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    let name: String = name
        .trim_end_matches([' ', '.'])
        .chars()
        .take(120)
        .collect();
    if name.is_empty() {
        "wallpaper".into()
    } else {
        name
    }
}

pub fn source_rect(
    img_w: f64,
    img_h: f64,
    virtual_w: f64,
    virtual_h: f64,
    transform: Transform,
) -> (f64, f64, f64, f64) {
    if img_w <= 0.0 || img_h <= 0.0 || virtual_w <= 0.0 || virtual_h <= 0.0 {
        return (0.0, 0.0, img_w, img_h);
    }
    let zoom = transform.zoom.clamp(1.0, 3.0);
    let scale = (virtual_w / img_w).max(virtual_h / img_h) * zoom;
    let width = virtual_w / scale;
    let height = virtual_h / scale;
    let cx = clamp_center(
        img_w / 2.0 + transform.offset_x.clamp(-1.0, 1.0) * img_w,
        width / 2.0,
        img_w - width / 2.0,
    );
    let cy = clamp_center(
        img_h / 2.0 + transform.offset_y.clamp(-1.0, 1.0) * img_h,
        height / 2.0,
        img_h - height / 2.0,
    );
    (cx - width / 2.0, cy - height / 2.0, width, height)
}

fn clamp_center(value: f64, low: f64, high: f64) -> f64 {
    if low <= high {
        value.clamp(low, high)
    } else {
        (low + high) / 2.0
    }
}

fn virtual_bounds(monitors: &[MonitorInfo]) -> (i32, i32, f64, f64) {
    let left = monitors.iter().map(|m| m.left).min().unwrap_or(0);
    let top = monitors.iter().map(|m| m.top).min().unwrap_or(0);
    let right = monitors.iter().map(|m| m.right).max().unwrap_or(1);
    let bottom = monitors.iter().map(|m| m.bottom).max().unwrap_or(1);
    (
        left,
        top,
        (right - left).max(1) as f64,
        (bottom - top).max(1) as f64,
    )
}

fn topology(monitors: &[MonitorInfo]) -> String {
    let mut list: Vec<String> = monitors
        .iter()
        .map(|m| {
            format!(
                "{}|{},{},{},{}",
                m.device_path, m.left, m.top, m.right, m.bottom
            )
        })
        .collect();
    list.sort();
    let joined = list.join(";");
    let mut hash = 17u32;
    for byte in joined.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(byte as u32);
    }
    format!("v1_{hash:08X}")
}

fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn download_with_retry(url: &str) -> Result<Vec<u8>, String> {
    let mut last = "下载失败".to_string();
    let cookie = auth::cookie();
    for attempt in 0..3 {
        match client::download(url, client::MAX_IMAGE_BYTES, cookie.as_deref()) {
            Ok(bytes) => return Ok(bytes),
            Err(error) => last = error,
        }
        if attempt < 2 {
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    }
    Err(last)
}

fn to_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory(bytes).map_err(|_| "壁纸图片无法解析".to_string())?;
    to_jpeg_from(&image)
}

fn to_jpeg_from(image: &image::DynamicImage) -> Result<Vec<u8>, String> {
    let rgb = image.to_rgb8();
    let mut out = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 92);
    encoder
        .encode_image(&rgb)
        .map_err(|error| format!("壁纸转码失败：{error}"))?;
    Ok(out)
}

fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = target.with_extension("tmp");
    fs::write(&temp, bytes).map_err(|error| format!("写入壁纸失败：{error}"))?;
    if fs::rename(&temp, target).is_err() {
        let _ = fs::remove_file(target);
        fs::rename(&temp, target).map_err(|error| {
            let _ = fs::remove_file(&temp);
            format!("写入壁纸失败：{error}")
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_file_names() {
        assert_eq!(safe_name("方寸:6?"), "方寸 6");
        assert_eq!(safe_name("..."), "wallpaper");
        assert_eq!(safe_name("a/b\\c"), "a b c");
    }

    #[test]
    fn rejects_unsafe_ids() {
        assert!(file_id("../x").is_err());
        assert!(file_id("wp_1-2").is_ok());
    }

    #[test]
    fn covers_virtual_screen_at_zoom_one() {
        let rect = source_rect(1920.0, 1080.0, 1920.0, 1080.0, Transform::default());
        assert!((rect.0 - 0.0).abs() < 0.01);
        assert!((rect.2 - 1920.0).abs() < 0.01);
    }

    #[test]
    fn zooms_in_by_halving_visible_window() {
        let rect = source_rect(
            1920.0,
            1080.0,
            1920.0,
            1080.0,
            Transform {
                zoom: 2.0,
                offset_x: 0.0,
                offset_y: 0.0,
            },
        );
        assert!((rect.2 - 960.0).abs() < 0.01);
        assert!((rect.3 - 540.0).abs() < 0.01);
    }
}
