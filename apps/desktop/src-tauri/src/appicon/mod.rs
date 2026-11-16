//! 应用图标：一处选择同步托盘、窗口、程序文件与快捷方式。

mod exe;
mod ico;
mod shell;

use std::ffi::OsStr;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::image::Image;
use tauri::{AppHandle, Manager};

const ICON_FILE: &str = "app-icon.png";
const LEGACY_ICON_FILE: &str = "tray-icon.png";
const WINDOW_ICON_SIZE: u32 = 32;
const ORIGINAL_ICON: &[u8] = include_bytes!("../../icons/icon.ico");

/// 连续选择时串行执行，避免并发替换同一个程序文件
static APPLY: Mutex<()> = Mutex::new(());

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| error.to_string())
}

fn save_source(app: &AppHandle, bytes: &[u8]) -> Result<(), String> {
    let dir = config_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    std::fs::write(dir.join(ICON_FILE), bytes).map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(dir.join(LEGACY_ICON_FILE));
    Ok(())
}

fn clear_source(app: &AppHandle) -> Result<(), String> {
    let dir = config_dir(app)?;
    let _ = std::fs::remove_file(dir.join(ICON_FILE));
    let _ = std::fs::remove_file(dir.join(LEGACY_ICON_FILE));
    Ok(())
}

fn load_source(app: &AppHandle) -> Option<Vec<u8>> {
    let dir = config_dir(app).ok()?;
    std::fs::read(dir.join(ICON_FILE))
        .or_else(|_| std::fs::read(dir.join(LEGACY_ICON_FILE)))
        .ok()
}

fn encode_png(image: &image::RgbaImage) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgba8(image.clone())
        .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

fn default_source() -> Result<image::RgbaImage, String> {
    let image = image::load_from_memory_with_format(ORIGINAL_ICON, image::ImageFormat::Ico)
        .map_err(|error| error.to_string())?;
    let side = image.width().min(image.height());
    Ok(image::imageops::crop_imm(&image, 0, 0, side, side).to_image())
}

fn apply_tray(app: &AppHandle, rgba: &[u8]) {
    if let Some(tray) = app.tray_by_id("main") {
        let image = Image::new_owned(rgba.to_vec(), WINDOW_ICON_SIZE, WINDOW_ICON_SIZE);
        let _ = tray.set_icon(Some(image));
    }
}

fn apply_windows(app: &AppHandle, rgba: &[u8]) {
    for window in app.webview_windows().values() {
        let image = Image::new_owned(rgba.to_vec(), WINDOW_ICON_SIZE, WINDOW_ICON_SIZE);
        let _ = window.set_icon(image);
    }
}

/// 选择或重置应用图标；png 为源图 base64，空表示默认图标
pub fn apply(app: &AppHandle, png: Option<String>) -> Result<(), String> {
    let _guard = APPLY.lock().unwrap_or_else(|poison| poison.into_inner());

    let source = match png {
        Some(encoded) => {
            let bytes = crate::base64_decode(&encoded)?;
            let square = ico::square_source(&bytes)?;
            save_source(app, &encode_png(&square)?)?;
            Some(square)
        }
        None => {
            clear_source(app)?;
            None
        }
    };

    let icon32 = match &source {
        Some(square) => ico::resize(square, WINDOW_ICON_SIZE).into_raw(),
        None => ico::resize(&default_source()?, WINDOW_ICON_SIZE).into_raw(),
    };
    apply_tray(app, &icon32);
    apply_windows(app, &icon32);

    // 开发构建的 exe 会被 cargo 重建覆盖，不改程序文件
    if cfg!(debug_assertions) {
        return Ok(());
    }

    let entries = match &source {
        Some(square) => ico::entries(square)?,
        None => ico::parse(ORIGINAL_ICON)?,
    };
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;

    match exe::replace(&exe, &entries) {
        Ok(()) => {
            shell::update_shortcuts(&exe);
        }
        Err(exe::PatchError::Permission) => {
            let dir = config_dir(app)?;
            shell::apply_elevated(&ico::file(&entries), &dir, &exe)?;
        }
        Err(exe::PatchError::Failed(message)) => return Err(message),
    }
    Ok(())
}

/// 启动时清理替换备份，并按已保存图标同步窗口
pub fn startup(app: &AppHandle) {
    if let Ok(exe) = std::env::current_exe() {
        exe::cleanup(&exe);
    }
    let Some(source) = load_source(app) else { return };
    let Ok(square) = ico::square_source(&source) else { return };
    apply_windows(app, &ico::resize(&square, WINDOW_ICON_SIZE).into_raw());
}

/// 创建托盘前读取保存的图标，避免先显示默认图标
pub fn tray_icon(app: &AppHandle) -> Option<Image<'static>> {
    let source = load_source(app)?;
    let square = ico::square_source(&source).ok()?;
    let rgba = ico::resize(&square, WINDOW_ICON_SIZE).into_raw();
    Some(Image::new_owned(rgba, WINDOW_ICON_SIZE, WINDOW_ICON_SIZE))
}

/// 提权进程入口：--apply-icon <ico> <exe> <result>
pub fn run_helper_if_requested() {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(OsStr::new("--apply-icon")) {
        return;
    }
    let code = helper(args).unwrap_or(1);
    std::process::exit(code);
}

fn helper(mut args: impl Iterator<Item = std::ffi::OsString>) -> Result<i32, String> {
    let ico_path = args.next().ok_or("缺少图标文件")?;
    let exe_path = args.next().ok_or("缺少程序路径")?;
    let result_path = args.next().ok_or("缺少结果路径")?;

    let outcome = (|| -> Result<(), String> {
        let bytes = std::fs::read(&ico_path).map_err(|error| error.to_string())?;
        let entries = ico::parse(&bytes)?;
        let exe = PathBuf::from(exe_path);
        exe::replace(&exe, &entries).map_err(|error| error.to_string())?;
        shell::update_shortcuts(&exe);
        Ok(())
    })();

    let text = match &outcome {
        Ok(()) => "ok".to_string(),
        Err(error) => format!("failed: {error}"),
    };
    std::fs::write(&result_path, &text).map_err(|error| error.to_string())?;
    Ok(if outcome.is_ok() { 0 } else { 2 })
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_bundled_default_icon() {
        let image = super::default_source().unwrap();
        assert_eq!(image.width(), 256);
        assert_eq!(image.height(), 256);
    }
}
