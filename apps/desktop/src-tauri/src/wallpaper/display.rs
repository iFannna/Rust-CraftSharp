//! 界面壁纸图：登录后用原图生成无水印缩略图和预览图，失败时回退公共预览。

use std::fs;
#[cfg(target_os = "linux")]
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::SystemTime;

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::DynamicImage;
use tauri::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use tauri::http::{Response, StatusCode};
use tauri::{AppHandle, Manager};

use super::store;
use super::{auth, client};

const PREVIEW_WIDTH: u32 = 2560;
const THUMB_WIDTH: u32 = 480;
const JPEG_QUALITY: u8 = 85;
const CACHE_LIMIT: u64 = 512 * 1024 * 1024;
const MAX_PARALLEL: usize = 3;

/// 静态壁纸的展示地址，由本地协议生成无水印图片
pub fn url(id: &str, kind: &str) -> String {
    #[cfg(windows)]
    {
        format!("http://wpimg.localhost/{id}/{kind}")
    }
    #[cfg(not(windows))]
    {
        format!("wpimg://localhost/{id}/{kind}")
    }
}

pub fn response(app: &AppHandle, path: &str) -> Response<Vec<u8>> {
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let valid = parts.len() == 2
        && matches!(parts[1], "thumb" | "preview")
        && store::file_id(parts[0]).is_ok();
    if !valid {
        return not_found();
    }

    let _permit = enter();
    match serve(app, parts[0], parts[1]) {
        Ok((bytes, mime, cacheable)) => Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, mime)
            .header(
                CACHE_CONTROL,
                if cacheable {
                    "public, max-age=86400"
                } else {
                    "no-store"
                }
            )
            .body(bytes)
            .unwrap_or_else(|_| not_found()),
        Err(_) => not_found(),
    }
}

fn serve(app: &AppHandle, id: &str, kind: &str) -> Result<(Vec<u8>, &'static str, bool), String> {
    if auth::logged_in() {
        if let Ok(bytes) = fs::read(target(app, id, kind)?) {
            if !bytes.is_empty() {
                return Ok((bytes, "image/jpeg", true));
            }
        }
        if let Ok(bytes) = build_clean(app, id, kind) {
            return Ok((bytes, "image/jpeg", true));
        }
    }

    let size = if kind == "thumb" { 800 } else { 1920 };
    let url = client::with_size(&client::preview_url(id), size);
    let bytes = client::download(&url, client::MAX_IMAGE_BYTES, None)?;
    let mime = sniff(&bytes);
    Ok((bytes, mime, false))
}

fn build_clean(app: &AppHandle, id: &str, kind: &str) -> Result<Vec<u8>, String> {
    let dir = cache_dir(app)?;
    let preview = dir.join(format!("{id}-preview.jpg"));
    let thumb = dir.join(format!("{id}-thumb.jpg"));

    if !preview.exists() {
        let cookie = auth::cookie().ok_or_else(|| "需要登录".to_string())?;
        let bytes = client::download(
            &client::original_url(id),
            client::MAX_IMAGE_BYTES,
            Some(&cookie),
        )?;
        let image = image::load_from_memory(&bytes)
            .map_err(|_| "壁纸原图无法解析".to_string())?;
        let preview_image = fit(image, PREVIEW_WIDTH);
        store::write_atomic(&preview, &encode(&preview_image)?)?;
        let thumb_image = fit(preview_image, THUMB_WIDTH);
        store::write_atomic(&thumb, &encode(&thumb_image)?)?;
    } else if !thumb.exists() {
        let image = image::open(&preview).map_err(|_| "壁纸预览无法解析".to_string())?;
        let thumb_image = fit(image, THUMB_WIDTH);
        store::write_atomic(&thumb, &encode(&thumb_image)?)?;
    }

    let file = if kind == "thumb" { &thumb } else { &preview };
    let bytes = fs::read(file).map_err(|error| format!("读取壁纸图失败：{error}"))?;
    prune(&dir);
    Ok(bytes)
}

fn target(app: &AppHandle, id: &str, kind: &str) -> Result<PathBuf, String> {
    let dir = cache_dir(app)?;
    Ok(dir.join(format!("{id}-{kind}.jpg")))
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("wallpaper-images");
    fs::create_dir_all(&dir).map_err(|error| format!("创建壁纸图缓存失败：{error}"))?;
    Ok(dir)
}

fn fit(mut image: DynamicImage, width: u32) -> DynamicImage {
    if image.width() > width {
        image = image.resize(width, u32::MAX, FilterType::Lanczos3);
    }
    image
}

fn encode(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let rgb = image.to_rgb8();
    let mut out = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    encoder
        .encode_image(&rgb)
        .map_err(|error| format!("壁纸图转码失败：{error}"))?;
    Ok(out)
}

fn sniff(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else {
        "application/octet-stream"
    }
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// 动态壁纸视频的一段取流句柄；WebKit 只对 http(s) 走自带取流器
#[cfg(target_os = "linux")]
pub(crate) struct Slice {
    pub file: fs::File,
    pub start: u64,
    pub length: u64,
    pub total: u64,
    pub mime: &'static str,
    pub partial: bool,
}

#[cfg(target_os = "linux")]
pub(crate) enum SliceError {
    Missing,
    Range(u64),
}

/// 按单段 Range 定位缓存视频，调用方负责把内容写回客户端
#[cfg(target_os = "linux")]
pub(crate) fn video_slice(path: &Path, range: Option<&str>) -> Result<Slice, SliceError> {
    let mut file = fs::File::open(path).map_err(|_| SliceError::Missing)?;
    let total = file
        .metadata()
        .map(|meta| meta.len())
        .map_err(|_| SliceError::Missing)?;
    if total == 0 {
        return Err(SliceError::Missing);
    }

    let (start, end) = match range {
        Some(value) => parse_range(value, total).ok_or(SliceError::Range(total))?,
        None => (0, total - 1),
    };
    let mime = sniff_video(&mut file);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return Err(SliceError::Missing);
    }
    Ok(Slice {
        file,
        start,
        length: end - start + 1,
        total,
        mime,
        partial: range.is_some(),
    })
}

/// 站点可能发 WebM 原片，扩展名统一是 mp4，按文件头给真实类型
#[cfg(target_os = "linux")]
fn sniff_video(file: &mut fs::File) -> &'static str {
    let mut header = [0u8; 4];
    let mime = if file.read(&mut header).is_ok() && header == [0x1A, 0x45, 0xDF, 0xA3] {
        "video/webm"
    } else {
        "video/mp4"
    };
    let _ = file.seek(SeekFrom::Start(0));
    mime
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_range(value: &str, total: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    let (start, end) = spec.split_once('-')?;
    if start.is_empty() {
        let length = end.trim().parse::<u64>().ok()?.min(total);
        return (length > 0).then_some((total - length, total - 1));
    }
    let start = start.trim().parse::<u64>().ok()?;
    if start >= total {
        return None;
    }
    let end = if end.trim().is_empty() {
        total - 1
    } else {
        end.trim().parse::<u64>().ok()?.min(total - 1)
    };
    (start <= end).then_some((start, end))
}

/// 控制同时生成的数量，避免一次翻页同时解码几十张原图
fn enter() -> Permit {
    let gate = GATE.get_or_init(|| Gate {
        active: Mutex::new(0),
        free: Condvar::new(),
    });
    let mut active = gate.active.lock().unwrap_or_else(|error| error.into_inner());
    while *active >= MAX_PARALLEL {
        active = gate.free.wait(active).unwrap_or_else(|error| error.into_inner());
    }
    *active += 1;
    Permit
}

struct Gate {
    active: Mutex<usize>,
    free: Condvar,
}

static GATE: OnceLock<Gate> = OnceLock::new();

struct Permit;

impl Drop for Permit {
    fn drop(&mut self) {
        let Some(gate) = GATE.get() else { return };
        let mut active = gate.active.lock().unwrap_or_else(|error| error.into_inner());
        *active = active.saturating_sub(1);
        gate.free.notify_one();
    }
}

/// 超过上限时删除最旧的缓存，避免界面图无限堆积
fn prune(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut files: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    let mut total = 0u64;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        total += meta.len();
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        files.push((entry.path(), meta.len(), modified));
    }
    if total <= CACHE_LIMIT {
        return;
    }
    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, len, _) in files {
        if total <= CACHE_LIMIT {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fits_and_encodes() {
        let source = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            1000,
            500,
            image::Rgba([20, 40, 60, 255]),
        ));
        let fitted = fit(source, THUMB_WIDTH);
        assert_eq!(fitted.width(), THUMB_WIDTH);
        let bytes = encode(&fitted).unwrap();
        assert_eq!(sniff(&bytes), "image/jpeg");
    }

    #[test]
    fn keeps_small_images() {
        let source = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            100,
            50,
            image::Rgba([1, 2, 3, 255]),
        ));
        assert_eq!(fit(source, THUMB_WIDTH).width(), 100);
    }

    #[test]
    fn sniffs_webp() {
        let mut bytes = Vec::from(*b"RIFF");
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes.extend_from_slice(b"WEBPVP8 ");
        assert_eq!(sniff(&bytes), "image/webp");
    }

    #[test]
    fn parses_video_ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=0-9999", 1000), Some((0, 999)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=-0", 1000), None);
    }
}
