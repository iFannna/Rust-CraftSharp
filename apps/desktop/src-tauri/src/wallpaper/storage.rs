//! 壁纸存储根目录：路径记录、无感迁移与旧目录清理。
//!
//! 迁移期间不停止正在播放的动态壁纸：优先建立硬链接，跨盘时复制；
//! 旧目录里被占用的文件记入待清理列表，下次启动时再删。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const ROOT_FILE: &str = "wallpaper-root";
const CLEANUP_FILE: &str = "wallpaper-cleanup";
const MARKER: &str = ".craftsharp";

fn config_dir(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_default()
}

/// 当前存储根；未设置时使用应用数据目录下的 wallpapers
pub fn root(app: &AppHandle) -> PathBuf {
    let dir = config_dir(app);
    let configured = fs::read_to_string(dir.join(ROOT_FILE)).ok().and_then(|text| {
        let path = text.trim_end_matches(['\r', '\n']).to_owned();
        (!path.is_empty()).then(|| PathBuf::from(path))
    });
    configured.unwrap_or_else(|| dir.join("wallpapers"))
}

pub fn current(app: &AppHandle) -> String {
    root(app).to_string_lossy().into_owned()
}

/// 在资源管理器中打开当前存储目录
pub fn open(app: &AppHandle) -> Result<(), String> {
    let dir = root(app);
    fs::create_dir_all(&dir).map_err(|error| format!("无法打开文件夹：{error}"))?;

    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let path = HSTRING::from(dir.to_string_lossy().into_owned());
        let action = HSTRING::from("open");
        let empty = HSTRING::new();
        // SAFETY: 路径与操作均为局部宽字符串，调用期间保持有效
        let result =
            unsafe { ShellExecuteW(None, &action, &path, &empty, &empty, SW_SHOWNORMAL) };
        if result.0 as isize <= 32 {
            return Err("无法打开文件夹".into());
        }
        Ok(())
    }

    #[cfg(not(windows))]
    Err("当前平台未实现".into())
}

pub fn init(app: &AppHandle) {
    let dir = root(app);
    if fs::create_dir_all(&dir).is_ok() {
        let _ = mark(&dir);
    }
    clean_pending(app);
}

/// 切换存储根：先复制到新目录，再切换配置，最后清理旧目录
pub fn migrate(app: &AppHandle, target: &str) -> Result<String, String> {
    let target = PathBuf::from(target.trim());
    if !target.is_absolute() {
        return Err("请选择完整的文件夹路径".into());
    }
    if target.parent().is_none() {
        return Err("请选择盘符下的文件夹".into());
    }

    let old = fs::canonicalize(root(app)).ok();
    fs::create_dir_all(&target).map_err(|error| format!("无法创建目标文件夹：{error}"))?;
    let new = fs::canonicalize(&target).map_err(|error| format!("目标文件夹不可用：{error}"))?;

    if let Some(old) = &old {
        if &new == old {
            return Ok(plain(&new).to_string_lossy().into_owned());
        }
        if new.starts_with(old) || old.starts_with(&new) {
            return Err("不能选择当前目录的上级或下级目录".into());
        }
    }

    claim(&new)?;
    if let Some(old) = &old {
        copy_tree(old, &new).map_err(|error| format!("迁移壁纸失败：{error}"))?;
    }
    let stored = plain(&new);
    write_root(app, &stored)?;
    forget_pending(app, &new);

    let stale = old.filter(|old| !remove_tree(old));
    if let Some(old) = stale {
        remember_pending(app, &old);
    }
    Ok(stored.to_string_lossy().into_owned())
}

/// 去掉 canonicalize 在 Windows 上附加的 verbatim 前缀，保持路径可读
fn plain(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path.to_path_buf(),
    }
}

/// 恢复默认存储目录，并把现有缓存迁回
pub fn reset(app: &AppHandle) -> Result<String, String> {
    let dir = config_dir(app);
    let default = dir.join("wallpapers");
    let current = root(app);
    let setting = dir.join(ROOT_FILE);
    let default_plain = plain(&default).to_string_lossy().into_owned();

    if fs::canonicalize(&current).ok() == fs::canonicalize(&default).ok() {
        let _ = fs::remove_file(setting);
        if fs::create_dir_all(&default).is_ok() {
            let _ = mark(&default);
        }
        return Ok(default_plain);
    }

    let old = fs::canonicalize(&current).ok();
    fs::create_dir_all(&default).map_err(|error| format!("无法创建默认目录：{error}"))?;
    let new = fs::canonicalize(&default).map_err(|error| format!("默认目录不可用：{error}"))?;
    if let Some(old) = &old {
        if new.starts_with(old) || old.starts_with(&new) {
            return Err("当前目录与默认目录相互包含，无法迁移".into());
        }
    }

    mark(&new)?;
    if let Some(old) = &old {
        copy_tree(old, &new).map_err(|error| format!("迁移壁纸失败：{error}"))?;
    }
    let _ = fs::remove_file(&setting);
    forget_pending(app, &new);

    let stale = old.filter(|old| !remove_tree(old));
    if let Some(old) = stale {
        remember_pending(app, &old);
    }
    Ok(default_plain)
}

fn mark(dir: &Path) -> Result<(), String> {
    fs::write(dir.join(MARKER), "wallpapers")
        .map_err(|error| format!("无法写入目标文件夹：{error}"))
}

/// 只接受空目录或之前由本应用管理的目录，避免误删用户文件
fn claim(dir: &Path) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|error| format!("无法读取目标文件夹：{error}"))?;
    let mut marked = false;
    let mut occupied = false;
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy() == MARKER {
            marked = true;
        } else {
            occupied = true;
        }
    }
    if occupied && !marked {
        return Err("该文件夹不是空的，请选择空文件夹".into());
    }
    mark(dir)
}

fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().ends_with(".tmp") {
            continue;
        }
        let target = dst.join(&name);
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
            continue;
        }
        if target.metadata().is_ok_and(|meta| meta.len() > 0) {
            continue;
        }
        transfer(&entry.path(), &target)?;
    }
    Ok(())
}

/// 同盘优先硬链接，切换根目录后新旧路径同时可用；跨盘退回复制
fn transfer(src: &Path, dst: &Path) -> io::Result<()> {
    if fs::hard_link(src, dst).is_ok() {
        return Ok(());
    }
    let name = dst.file_name().unwrap_or_default().to_string_lossy();
    let temp = dst.with_file_name(format!("{name}.tmp"));
    fs::copy(src, &temp)?;
    if let Err(error) = fs::rename(&temp, dst) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    Ok(())
}

fn write_root(app: &AppHandle, path: &Path) -> Result<(), String> {
    let dir = config_dir(app);
    fs::create_dir_all(&dir).map_err(|error| format!("写入存储设置失败：{error}"))?;
    let temp = dir.join(format!("{ROOT_FILE}.tmp"));
    fs::write(&temp, path.to_string_lossy().as_bytes())
        .map_err(|error| format!("写入存储设置失败：{error}"))?;
    fs::rename(&temp, dir.join(ROOT_FILE)).map_err(|error| format!("写入存储设置失败：{error}"))
}

fn remove_tree(dir: &Path) -> bool {
    if !dir.exists() {
        return true;
    }
    let mut clean = true;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let removed = if path.is_dir() {
                remove_tree(&path)
            } else {
                fs::remove_file(&path).is_ok() || !path.exists()
            };
            clean &= removed;
        }
    }
    clean && fs::remove_dir(dir).is_ok()
}

fn remember_pending(app: &AppHandle, dir: &Path) {
    let file = config_dir(app).join(CLEANUP_FILE);
    let mut text = fs::read_to_string(&file).unwrap_or_default();
    let line = dir.to_string_lossy();
    if text.lines().any(|item| item == line) {
        return;
    }
    text.push_str(&line);
    text.push('\n');
    let _ = fs::write(file, text);
}

fn forget_pending(app: &AppHandle, dir: &Path) {
    let file = config_dir(app).join(CLEANUP_FILE);
    let Ok(text) = fs::read_to_string(&file) else {
        return;
    };
    let line = dir.to_string_lossy();
    let rest: String = text
        .lines()
        .filter(|item| !item.is_empty() && *item != line)
        .map(|item| format!("{item}\n"))
        .collect();
    if rest.is_empty() {
        let _ = fs::remove_file(file);
    } else {
        let _ = fs::write(file, rest);
    }
}

/// 启动时清理上次迁移遗留的旧目录；当前根目录或它的祖先一律跳过
fn clean_pending(app: &AppHandle) {
    let file = config_dir(app).join(CLEANUP_FILE);
    let Ok(text) = fs::read_to_string(&file) else {
        return;
    };
    let current = fs::canonicalize(root(app)).ok();
    let mut rest = String::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let dir = PathBuf::from(line);
        let owned = current
            .as_ref()
            .map_or(true, |current| !current.starts_with(&dir) && !dir.starts_with(current));
        if !owned || !remove_tree(&dir) {
            rest.push_str(line);
            rest.push('\n');
        }
    }
    if rest.is_empty() {
        let _ = fs::remove_file(file);
    } else {
        let _ = fs::write(file, rest);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "craftsharp-storage-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_unmarked_folder() {
        let dir = temp("claim");
        fs::write(dir.join("keep.txt"), b"x").unwrap();
        assert!(claim(&dir).is_err());
        fs::write(dir.join(MARKER), b"wallpapers").unwrap();
        assert!(claim(&dir).is_ok());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn copies_tree_and_skips_temp_files() {
        let src = temp("copy-src");
        let dst = temp("copy-dst");
        fs::create_dir_all(src.join("videos")).unwrap();
        fs::write(src.join("wp_1-full.jpg"), b"image").unwrap();
        fs::write(src.join("videos/wp_1.mp4"), b"video").unwrap();
        fs::write(src.join("wp_2-full.jpg.tmp"), b"half").unwrap();

        copy_tree(&src, &dst).unwrap();

        assert_eq!(fs::read(dst.join("wp_1-full.jpg")).unwrap(), b"image");
        assert_eq!(fs::read(dst.join("videos/wp_1.mp4")).unwrap(), b"video");
        assert!(!dst.join("wp_2-full.jpg.tmp").exists());

        let _ = fs::remove_dir_all(src);
        let _ = fs::remove_dir_all(dst);
    }

    #[test]
    fn strips_verbatim_prefix() {
        assert_eq!(plain(Path::new(r"\\?\D:\Wallpapers")), PathBuf::from(r"D:\Wallpapers"));
        assert_eq!(plain(Path::new(r"\\?\UNC\server\share")), PathBuf::from(r"\\server\share"));
    }

    #[test]
    fn removes_nested_tree() {
        let dir = temp("prune");
        fs::create_dir_all(dir.join("span").join("wp_1")).unwrap();
        fs::write(dir.join("span").join("wp_1").join("monitor.jpg"), b"x").unwrap();

        assert!(remove_tree(&dir));
        assert!(!dir.exists());
    }
}
