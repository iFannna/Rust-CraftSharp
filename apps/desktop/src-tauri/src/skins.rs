//! 皮肤库：上传皮肤存 `skins/<wide|slim>/<名称>.png`，名称即文件名，类型即目录。
//! 前端只读清单与贴图，导入是唯一写入路径。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 64x64 PNG 远小于此值，上限只用于挡住异常载荷
const MAX_BASE64: usize = 4_000_000;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkinEntry {
    pub name: String,
    pub path: String,
}

fn skin_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("skins"))
        .map_err(|error| error.to_string())
}

fn type_dir(root: &Path, skin_type: &str) -> Result<PathBuf, String> {
    match skin_type {
        "wide" | "slim" => Ok(root.join(skin_type)),
        _ => Err("皮肤类型无效".into()),
    }
}

fn validate_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if name.chars().count() > 32 {
        return Err("名称长度不能超过32个字符".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == ' ')
    {
        return Err("名称只能包含字母、数字、下划线、横杠和空格".into());
    }
    Ok(name)
}

/// 只读文件头拿宽高，64x64 以外的尺寸一律拒绝，再做一次完整解码确认可渲染
fn decode_skin(data_base64: &str) -> Result<Vec<u8>, String> {
    if data_base64.len() > MAX_BASE64 {
        return Err("皮肤文件过大".into());
    }
    let bytes = crate::base64_decode(data_base64)?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("文件不是有效的 PNG".into());
    }
    let (width, height) = image::ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|_| "文件不是有效的 PNG".to_string())?
        .into_dimensions()
        .map_err(|_| "文件不是有效的 PNG".to_string())?;
    match (width, height) {
        (64, 64) => {}
        (64, 32) => return Err("旧版 64x32 皮肤不支持，请使用 64x64".into()),
        _ => return Err(format!("皮肤尺寸必须是 64x64，当前为 {width}x{height}")),
    }
    image::load_from_memory(&bytes).map_err(|_| "文件不是有效的 PNG".to_string())?;
    Ok(bytes)
}

fn entry_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return Err("皮肤名称无效".into());
    }
    Ok(dir.join(format!("{name}.png")))
}

pub fn list(app: &AppHandle, skin_type: &str) -> Result<Vec<SkinEntry>, String> {
    let dir = type_dir(&skin_root(app)?, skin_type)?;
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut items = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let is_png = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("png"));
        if !is_png {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        items.push(SkinEntry {
            name: name.to_string(),
            path: path.to_string_lossy().into_owned(),
        });
    }
    items.sort_by_key(|item| item.name.to_lowercase());
    Ok(items)
}

fn import_into(
    root: &Path,
    name: &str,
    skin_type: &str,
    data_base64: &str,
) -> Result<SkinEntry, String> {
    let name = validate_name(name)?;
    let bytes = decode_skin(data_base64)?;
    let dir = type_dir(root, skin_type)?;
    fs::create_dir_all(&dir).map_err(|error| format!("复制文件失败：{error}"))?;
    let path = entry_path(&dir, name)?;

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                format!("已存在同名皮肤 \"{name}\"，请使用其他名称")
            } else {
                format!("复制文件失败：{error}")
            }
        })?;
    if let Err(error) = file.write_all(&bytes) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(format!("复制文件失败：{error}"));
    }

    Ok(SkinEntry {
        name: name.to_string(),
        path: path.to_string_lossy().into_owned(),
    })
}

fn rename_in(
    root: &Path,
    skin_type: &str,
    from: &str,
    to: &str,
) -> Result<SkinEntry, String> {
    let to = validate_name(to)?;
    let dir = type_dir(root, skin_type)?;
    let source = entry_path(&dir, from)?;
    if !source.is_file() {
        return Err("皮肤不存在".into());
    }
    let target = entry_path(&dir, to)?;
    if target.exists() {
        return Err(format!("已存在同名皮肤 \"{to}\""));
    }
    fs::rename(&source, &target).map_err(|error| format!("重命名失败：{error}"))?;
    Ok(SkinEntry {
        name: to.to_string(),
        path: target.to_string_lossy().into_owned(),
    })
}

fn remove_in(root: &Path, skin_type: &str, name: &str) -> Result<(), String> {
    let dir = type_dir(root, skin_type)?;
    let path = entry_path(&dir, name)?;
    fs::remove_file(&path).map_err(|_| "删除文件失败".to_string())
}

#[tauri::command]
pub fn list_skins(app: AppHandle, skin_type: String) -> Result<Vec<SkinEntry>, String> {
    list(&app, &skin_type)
}

#[tauri::command]
pub async fn import_skin(
    app: AppHandle,
    name: String,
    skin_type: String,
    data_base64: String,
) -> Result<SkinEntry, String> {
    let root = skin_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        import_into(&root, &name, &skin_type, &data_base64)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn rename_skin(
    app: AppHandle,
    skin_type: String,
    from: String,
    to: String,
) -> Result<SkinEntry, String> {
    rename_in(&skin_root(&app)?, &skin_type, &from, &to)
}

#[tauri::command]
pub fn remove_skin(app: AppHandle, skin_type: String, name: String) -> Result<(), String> {
    remove_in(&skin_root(&app)?, &skin_type, &name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgba};

    fn png_base64(width: u32, height: u32) -> String {
        let image: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(width, height, Rgba([30, 120, 210, 255]));
        let mut png = Vec::new();
        image
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        crate::base64(&png)
    }

    fn jpeg_base64() -> String {
        let image: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_pixel(64, 64, Rgb([200, 40, 40]));
        let mut jpeg = Vec::new();
        image
            .write_to(
                &mut std::io::Cursor::new(&mut jpeg),
                image::ImageFormat::Jpeg,
            )
            .unwrap();
        crate::base64(&jpeg)
    }

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "craftsharp-skins-{tag}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn accepts_64x64_png() {
        let root = temp_root("accept");
        let entry = import_into(&root, "my skin", "wide", &png_base64(64, 64)).unwrap();
        assert!(Path::new(&entry.path).is_file());
        assert_eq!(entry.name, "my skin");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_32x32_png() {
        let root = temp_root("small");
        let error = import_into(&root, "small", "wide", &png_base64(32, 32)).unwrap_err();
        assert!(error.contains("64x64"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_legacy_64x32_png() {
        let root = temp_root("legacy");
        let error = import_into(&root, "legacy", "wide", &png_base64(64, 32)).unwrap_err();
        assert!(error.contains("64x32"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_jpeg_renamed_to_png() {
        let root = temp_root("jpeg");
        let error = import_into(&root, "fake", "wide", &jpeg_base64()).unwrap_err();
        assert!(error.contains("PNG"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_oversized_payload() {
        let root = temp_root("oversize");
        let payload = "A".repeat(MAX_BASE64 + 1);
        let error = import_into(&root, "big", "wide", &payload).unwrap_err();
        assert!(error.contains("过大"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_duplicate_name() {
        let root = temp_root("duplicate");
        let data = png_base64(64, 64);
        import_into(&root, "same", "wide", &data).unwrap();
        let error = import_into(&root, "same", "wide", &data).unwrap_err();
        assert!(error.contains("已存在同名皮肤"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_invalid_name() {
        let root = temp_root("name");
        let error = import_into(&root, "../evil", "wide", &png_base64(64, 64)).unwrap_err();
        assert!(error.contains("名称"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_and_remove_file() {
        let root = temp_root("rename");
        import_into(&root, "old", "slim", &png_base64(64, 64)).unwrap();
        let entry = rename_in(&root, "slim", "old", "new").unwrap();
        assert!(Path::new(&entry.path).is_file());
        remove_in(&root, "slim", "new").unwrap();
        assert!(!Path::new(&entry.path).exists());
        let _ = fs::remove_dir_all(&root);
    }
}
