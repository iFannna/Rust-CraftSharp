//! 壁纸存储根目录：路径记录、无感迁移与旧缓存清理。
//!
//! 用户选择父目录，缓存统一放在 <父目录>\CraftSharp\wallpapers。
//! 迁移期间不停止正在播放的动态壁纸：优先建立硬链接，跨盘时复制；
//! 旧目录里被占用的文件记入待清理列表，下次启动时再删。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const ROOT_FILE: &str = "wallpaper-root";
const CLEANUP_FILE: &str = "wallpaper-cleanup";
const FOLDER: &str = "CraftSharp";
const LEAF: &str = "wallpapers";
/// 旧版本写在存储目录里的归属标记，只用于识别与清理
const MARKER: &str = ".craftsharp";

fn config_dir(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_default()
}

fn default_root(app: &AppHandle) -> PathBuf {
    let base = config_dir(app);
    base.parent()
        .map_or_else(|| base.join(FOLDER), |parent| parent.join(FOLDER))
        .join(LEAF)
}

/// 当前存储根；未设置时使用应用数据目录旁的 CraftSharp\wallpapers
pub fn root(app: &AppHandle) -> PathBuf {
    let dir = config_dir(app);
    let configured = fs::read_to_string(dir.join(ROOT_FILE)).ok().and_then(|text| {
        let path = text.trim_end_matches(['\r', '\n']).to_owned();
        (!path.is_empty()).then(|| PathBuf::from(path))
    });
    configured.unwrap_or_else(|| default_root(app))
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

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .status()
            .map_err(|error| format!("无法打开文件夹：{error}"))?;
        Ok(())
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    Err("当前平台未实现".into())
}

pub fn init(app: &AppHandle) {
    absorb_legacy(app);
    let _ = fs::create_dir_all(root(app));
    clean_pending(app);
}

/// 旧默认目录位于应用标识符下，升级后把缓存并入新的默认目录
fn absorb_legacy(app: &AppHandle) {
    if config_dir(app).join(ROOT_FILE).exists() {
        return;
    }
    let Ok(legacy) = fs::canonicalize(config_dir(app).join(LEAF)) else {
        return;
    };
    let target = default_root(app);
    if fs::canonicalize(&target).ok().as_ref() == Some(&legacy) {
        return;
    }
    if fs::create_dir_all(&target).is_err() {
        return;
    }
    if copy_cache(&legacy, &target).is_ok() {
        prune_cache(&legacy);
    }
}

/// 用户选中的父目录与实际存储目录之间的封装规则
fn target_for(picked: &Path) -> PathBuf {
    if named(picked, LEAF) && picked.parent().is_some_and(|parent| named(parent, FOLDER)) {
        return picked.to_path_buf();
    }
    if named(picked, FOLDER) {
        return picked.join(LEAF);
    }
    picked.join(FOLDER).join(LEAF)
}

fn named(path: &Path, value: &str) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(value))
}

/// 切换存储根：先复制到新目录，再切换配置，最后清理旧目录
pub fn migrate(app: &AppHandle, target: &str) -> Result<String, String> {
    let picked = PathBuf::from(target.trim());
    if !picked.is_absolute() {
        return Err("请选择完整的文件夹路径".into());
    }
    fs::create_dir_all(&picked).map_err(|error| format!("无法创建目标文件夹：{error}"))?;
    let picked = plain(&fs::canonicalize(&picked).map_err(|error| {
        format!("目标文件夹不可用：{error}")
    })?);
    let dir = target_for(&picked);
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建存储目录：{error}"))?;
    let new = fs::canonicalize(&dir).map_err(|error| format!("存储目录不可用：{error}"))?;

    let old = fs::canonicalize(root(app)).ok();
    if old.as_ref() == Some(&new) {
        return Ok(plain(&new).to_string_lossy().into_owned());
    }
    if let Some(old) = &old {
        copy_cache(old, &new).map_err(|error| format!("迁移壁纸失败：{error}"))?;
    }

    let stored = plain(&new);
    write_root(app, &stored)?;
    forget_pending(app, &new);

    let stale = old.filter(|old| !prune_cache(old));
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
    let setting = config_dir(app).join(ROOT_FILE);
    let default = default_root(app);
    let default_plain = plain(&default).to_string_lossy().into_owned();
    let current = root(app);

    if fs::canonicalize(&current).ok() == fs::canonicalize(&default).ok() {
        let _ = fs::remove_file(setting);
        let _ = fs::create_dir_all(&default);
        return Ok(default_plain);
    }

    let old = fs::canonicalize(&current).ok();
    fs::create_dir_all(&default).map_err(|error| format!("无法创建默认目录：{error}"))?;
    let new = fs::canonicalize(&default).map_err(|error| format!("默认目录不可用：{error}"))?;
    if let Some(old) = &old {
        copy_cache(old, &new).map_err(|error| format!("迁移壁纸失败：{error}"))?;
    }

    let _ = fs::remove_file(setting);
    forget_pending(app, &new);

    let stale = old.filter(|old| !prune_cache(old));
    if let Some(old) = stale {
        remember_pending(app, &old);
    }
    Ok(default_plain)
}

/// 只迁移本应用管理的缓存，避免把用户目录里的其他内容带进来
fn copy_cache(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    let Ok(entries) = fs::read_dir(src) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            let target = dst.join(&name);
            if name.eq_ignore_ascii_case("videos") {
                copy_flat(&path, &target, ".mp4")?;
            } else if name.eq_ignore_ascii_case("span") {
                copy_span(&path, &target)?;
            }
            continue;
        }
        if is_image(&name) {
            copy_file(&path, &dst.join(&name))?;
        }
    }
    Ok(())
}

fn copy_flat(src: &Path, dst: &Path, suffix: &str) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type()?.is_file() && name.starts_with("wp_") && name.ends_with(suffix) {
            copy_file(&entry.path(), &dst.join(&name))?;
        }
    }
    Ok(())
}

fn copy_span(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type()?.is_dir() && name.starts_with("wp_") {
            copy_tree(&entry.path(), &dst.join(&name))?;
        }
    }
    Ok(())
}

fn copy_file(src: &Path, dst: &Path) -> io::Result<()> {
    if dst.metadata().is_ok_and(|meta| meta.len() > 0) {
        return Ok(());
    }
    transfer(src, dst)
}

fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        // 目标目录可能就在源目录内部，跳过祖先以免递归
        if dst.starts_with(&path) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == MARKER || name.ends_with(".tmp") {
            continue;
        }
        let target = dst.join(&name);
        if entry.file_type()?.is_dir() {
            copy_tree(&path, &target)?;
            continue;
        }
        if target.metadata().is_ok_and(|meta| meta.len() > 0) {
            continue;
        }
        transfer(&path, &target)?;
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

/// 只移除本应用命名的缓存，目录里的其他内容保持原样
fn prune_cache(dir: &Path) -> bool {
    if !dir.exists() {
        return true;
    }
    let _ = fs::remove_file(dir.join(MARKER));
    let mut clean = true;
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if name.eq_ignore_ascii_case("videos") {
                clean &= prune_flat(&path, ".mp4");
            } else if name.eq_ignore_ascii_case("span") {
                clean &= prune_dirs(&path);
            }
        } else if is_image(&name) {
            clean &= fs::remove_file(&path).is_ok() || !path.exists();
        }
    }
    let _ = fs::remove_dir(dir);
    clean
}

fn is_image(name: &str) -> bool {
    name.starts_with("wp_") && (name.ends_with("-full.jpg") || name.ends_with("-preview.jpg"))
}

fn prune_flat(dir: &Path, suffix: &str) -> bool {
    let mut clean = true;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("wp_") && name.ends_with(suffix) {
                clean &= fs::remove_file(entry.path()).is_ok() || !entry.path().exists();
            }
        }
    }
    let _ = fs::remove_dir(dir);
    clean
}

fn prune_dirs(dir: &Path) -> bool {
    let mut clean = true;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with("wp_") {
                clean &= remove_tree(&entry.path());
            }
        }
    }
    let _ = fs::remove_dir(dir);
    clean
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

/// 启动时清理上次迁移遗留的旧缓存；只删本应用文件，当前根目录本身跳过
fn clean_pending(app: &AppHandle) {
    let file = config_dir(app).join(CLEANUP_FILE);
    let Ok(text) = fs::read_to_string(&file) else {
        return;
    };
    let current = fs::canonicalize(root(app)).ok();
    let mut rest = String::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let dir = PathBuf::from(line);
        let owned = current.as_ref().map_or(true, |current| current != &dir);
        if !owned || !prune_cache(&dir) {
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
    fn encapsulates_picked_folder() {
        assert_eq!(
            target_for(Path::new(r"D:\game")),
            PathBuf::from(r"D:\game\CraftSharp\wallpapers")
        );
        assert_eq!(
            target_for(Path::new(r"D:\game\CraftSharp")),
            PathBuf::from(r"D:\game\CraftSharp\wallpapers")
        );
        assert_eq!(
            target_for(Path::new(r"D:\game\CraftSharp\wallpapers")),
            PathBuf::from(r"D:\game\CraftSharp\wallpapers")
        );
    }

    #[test]
    fn copies_tree_and_skips_temp_files() {
        let src = temp("copy-src");
        let dst = temp("copy-dst");
        fs::create_dir_all(src.join("videos")).unwrap();
        fs::write(src.join("wp_1-full.jpg"), b"image").unwrap();
        fs::write(src.join("videos/wp_1.mp4"), b"video").unwrap();
        fs::write(src.join("wp_2-full.jpg.tmp"), b"half").unwrap();
        fs::write(src.join(MARKER), b"mark").unwrap();

        copy_tree(&src, &dst).unwrap();

        assert_eq!(fs::read(dst.join("wp_1-full.jpg")).unwrap(), b"image");
        assert_eq!(fs::read(dst.join("videos/wp_1.mp4")).unwrap(), b"video");
        assert!(!dst.join("wp_2-full.jpg.tmp").exists());
        assert!(!dst.join(MARKER).exists());

        let _ = fs::remove_dir_all(src);
        let _ = fs::remove_dir_all(dst);
    }

    #[test]
    fn copies_into_nested_target() {
        let src = temp("nested-src");
        let dst = src.join(FOLDER).join(LEAF);
        fs::create_dir_all(&dst).unwrap();
        fs::write(src.join("wp_1-full.jpg"), b"image").unwrap();

        copy_tree(&src, &dst).unwrap();

        assert_eq!(fs::read(dst.join("wp_1-full.jpg")).unwrap(), b"image");
        assert!(!dst.join(FOLDER).exists());
        let _ = fs::remove_dir_all(src);
    }

    #[test]
    fn copies_only_managed_cache() {
        let src = temp("cache-src");
        let dst = temp("cache-dst");
        fs::create_dir_all(src.join("videos")).unwrap();
        fs::create_dir_all(src.join("span").join("wp_3")).unwrap();
        fs::write(src.join("wp_1-full.jpg"), b"image").unwrap();
        fs::write(src.join("other.jpg"), b"other").unwrap();
        fs::write(src.join("notes.txt"), b"notes").unwrap();
        fs::write(src.join("videos/wp_2.mp4"), b"video").unwrap();
        fs::write(src.join("videos/keep.txt"), b"keep").unwrap();
        fs::write(src.join("span/wp_3/manifest"), b"topology").unwrap();
        fs::write(src.join("span/wp_3/monitor.jpg"), b"crop").unwrap();

        copy_cache(&src, &dst).unwrap();

        assert_eq!(fs::read(dst.join("wp_1-full.jpg")).unwrap(), b"image");
        assert_eq!(fs::read(dst.join("videos/wp_2.mp4")).unwrap(), b"video");
        assert_eq!(fs::read(dst.join("span/wp_3/manifest")).unwrap(), b"topology");
        assert_eq!(fs::read(dst.join("span/wp_3/monitor.jpg")).unwrap(), b"crop");
        assert!(!dst.join("other.jpg").exists());
        assert!(!dst.join("notes.txt").exists());
        assert!(!dst.join("videos/keep.txt").exists());

        let _ = fs::remove_dir_all(src);
        let _ = fs::remove_dir_all(dst);
    }

    #[test]
    fn prunes_only_managed_files() {
        let dir = temp("prune");
        fs::create_dir_all(dir.join("videos")).unwrap();
        fs::create_dir_all(dir.join("span").join("wp_3")).unwrap();
        fs::write(dir.join("wp_1-full.jpg"), b"image").unwrap();
        fs::write(dir.join("videos/wp_2.mp4"), b"video").unwrap();
        fs::write(dir.join("videos/keep.txt"), b"keep").unwrap();
        fs::write(dir.join("span/wp_3/monitor.jpg"), b"crop").unwrap();
        fs::write(dir.join("notes.txt"), b"mine").unwrap();

        assert!(prune_cache(&dir));

        assert!(!dir.join("wp_1-full.jpg").exists());
        assert!(!dir.join("videos/wp_2.mp4").exists());
        assert!(!dir.join("span/wp_3").exists());
        assert!(dir.join("videos/keep.txt").exists());
        assert!(dir.join("notes.txt").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn removes_nested_tree() {
        let dir = temp("remove");
        fs::create_dir_all(dir.join("span").join("wp_1")).unwrap();
        fs::write(dir.join("span").join("wp_1").join("monitor.jpg"), b"x").unwrap();

        assert!(remove_tree(&dir));
        assert!(!dir.exists());
    }

    #[test]
    fn strips_verbatim_prefix() {
        assert_eq!(plain(Path::new(r"\\?\D:\Wallpapers")), PathBuf::from(r"D:\Wallpapers"));
        assert_eq!(plain(Path::new(r"\\?\UNC\server\share")), PathBuf::from(r"\\server\share"));
    }
}
