//! 壁纸下载与本地缓存。统一转成 JPEG，兼容 IDesktopWallpaper 的格式要求。

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::client;

/// 原图接口需要登录，公共预览足够 1080p 与 2K 显示
const PREVIEW_SIZE: u32 = 1920;

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("wallpapers"))
        .map_err(|error| error.to_string())
}

/// 壁纸 id 直接参与文件名，只接受安全字符
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

/// 下载并转码，返回本地缓存路径；已有文件时直接复用
pub fn prepare(app: &AppHandle, id: &str, preview_url: &str) -> Result<PathBuf, String> {
    let id = file_id(id)?;
    let dir = root(app)?;
    fs::create_dir_all(&dir).map_err(|error| format!("创建壁纸目录失败：{error}"))?;

    let target = dir.join(format!("{id}.jpg"));
    if target.metadata().is_ok_and(|meta| meta.len() > 0) {
        return Ok(target);
    }

    let url = client::with_size(preview_url, PREVIEW_SIZE);
    let bytes = download_with_retry(&url)?;
    let jpeg = to_jpeg(&bytes)?;
    write_atomic(&target, &jpeg)?;
    Ok(target)
}

/// 另存到用户选择的位置，扩展名统一为 jpg，避免内容和后缀不一致
pub fn export(preview_url: &str, path: &str) -> Result<(), String> {
    let url = client::with_size(preview_url, PREVIEW_SIZE);
    let bytes = download_with_retry(&url)?;
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

/// 只保留当前壁纸，其他下载文件在应用成功后清理
pub fn sweep(app: &AppHandle, keep: &Path) {
    let Ok(dir) = root(app) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep {
            continue;
        }
        let _ = fs::remove_file(path);
    }
}

/// 另存为对话框的默认文件名，去掉 Windows 不允许的字符
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

fn download_with_retry(url: &str) -> Result<Vec<u8>, String> {
    let mut last = "下载失败".to_string();
    for attempt in 0..3 {
        match client::download(url, client::MAX_IMAGE_BYTES) {
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
    let rgb = image.to_rgb8();
    let mut out = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 92);
    encoder
        .encode_image(&rgb)
        .map_err(|error| format!("壁纸转码失败：{error}"))?;
    Ok(out)
}

fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = target.with_extension("jpg.tmp");
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
}
