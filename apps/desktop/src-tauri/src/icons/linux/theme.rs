//! freedesktop 图标主题索引：按图标名定位主题里的 PNG / SVG / XPM 文件。
//! 主题链、目录扫描与候选排序都只做一次，之后按名称查表。

use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use super::ffi;

/// 光栅化目标边长，与格子图标的最大尺寸一致；更大的原始图交给后续缩放。
const TARGET: u32 = 128;
const MAX_THEMES: usize = 8;
const EXTENSIONS: [&str; 3] = ["png", "svg", "xpm"];

struct Candidate {
    theme: usize,
    px: u32,
    scalable: bool,
    path: PathBuf,
}

struct Index {
    theme_count: usize,
    icons: HashMap<String, Vec<Candidate>>,
    pixmaps: Vec<PathBuf>,
}

fn index() -> &'static Index {
    static INDEX: OnceLock<Index> = OnceLock::new();
    INDEX.get_or_init(Index::build)
}

impl Index {
    fn build() -> Self {
        let roots = icon_roots();
        let themes = theme_chain(&roots);
        let mut icons: HashMap<String, Vec<Candidate>> = HashMap::new();
        for (order, theme) in themes.iter().enumerate() {
            for root in &roots {
                let dir = root.join(theme);
                if dir.is_dir() {
                    collect_theme(&dir, order, &mut icons);
                }
            }
        }
        Index { theme_count: themes.len(), icons, pixmaps: pixmap_dirs() }
    }
}

/// 按名称取最适合当前格子的图标文件：同一主题内优先矢量图，其次最接近目标尺寸。
pub fn find(name: &str) -> Option<PathBuf> {
    let index = index();
    if let Some(list) = index.icons.get(name) {
        if let Some(path) = pick(list, index.theme_count) {
            return Some(path.to_path_buf());
        }
    }
    for dir in &index.pixmaps {
        for extension in EXTENSIONS {
            let path = dir.join(format!("{name}.{extension}"));
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn pick<'a>(list: &'a [Candidate], themes: usize) -> Option<&'a Path> {
    for order in 0..themes {
        let mut scalable = None;
        let mut above = None;
        let mut below = None;
        for candidate in list.iter().filter(|candidate| candidate.theme == order) {
            if candidate.scalable {
                scalable = Some(candidate);
                break;
            }
            if candidate.px >= TARGET {
                if above.map_or(true, |best: &Candidate| candidate.px < best.px) {
                    above = Some(candidate);
                }
            } else if below.map_or(true, |best: &Candidate| candidate.px > best.px) {
                below = Some(candidate);
            }
        }
        if let Some(candidate) = scalable.or(above).or(below) {
            return Some(&candidate.path);
        }
    }
    None
}

fn collect_theme(dir: &Path, order: usize, out: &mut HashMap<String, Vec<Candidate>>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if !kind.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some((px, scalable)) = parse_size(&name.to_string_lossy()) else { continue };
        let size_dir = entry.path();
        let Ok(items) = fs::read_dir(&size_dir) else { continue };
        for item in items.flatten() {
            let path = item.path();
            if path.is_dir() {
                collect_files(&path, order, px, scalable, out);
            } else {
                insert(&path, order, px, scalable, out);
            }
        }
    }
}

fn collect_files(dir: &Path, order: usize, px: u32, scalable: bool, out: &mut HashMap<String, Vec<Candidate>>) {
    let Ok(items) = fs::read_dir(dir) else { return };
    for item in items.flatten() {
        insert(&item.path(), order, px, scalable, out);
    }
}

fn insert(path: &Path, order: usize, px: u32, scalable: bool, out: &mut HashMap<String, Vec<Candidate>>) {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else { return };
    if !EXTENSIONS.contains(&extension) {
        return;
    }
    let Some(name) = path.file_stem().and_then(|value| value.to_str()) else { return };
    out.entry(name.to_string())
        .or_default()
        .push(Candidate { theme: order, px, scalable, path: path.to_path_buf() });
}

/// 目录名换算成逻辑边长；scalable 单独标记。
fn parse_size(name: &str) -> Option<(u32, bool)> {
    if name == "scalable" {
        return Some((0, true));
    }
    let (base, scale) = match name.split_once('@') {
        Some((base, scale)) => (base, scale.trim_end_matches('x').parse::<u32>().ok()?),
        None => (name, 1),
    };
    let (width, height) = base.split_once('x')?;
    if width != height {
        return None;
    }
    Some((width.parse::<u32>().ok()? * scale, false))
}

fn theme_chain(roots: &[PathBuf]) -> Vec<String> {
    let mut chain = Vec::new();
    if let Some(active) = active_theme() {
        push_theme(&mut chain, &active, roots, 0);
    }
    if exists(roots, "Adwaita") && !chain.iter().any(|theme| theme == "Adwaita") {
        let position = chain.iter().position(|theme| theme == "hicolor").unwrap_or(chain.len());
        chain.insert(position, "Adwaita".to_string());
    }
    if !chain.iter().any(|theme| theme == "hicolor") {
        chain.push("hicolor".to_string());
    }
    chain.truncate(MAX_THEMES);
    chain
}

fn push_theme(chain: &mut Vec<String>, name: &str, roots: &[PathBuf], depth: usize) {
    if depth >= MAX_THEMES || chain.iter().any(|theme| theme == name) {
        return;
    }
    chain.push(name.to_string());
    for parent in inherits(name, roots) {
        push_theme(chain, &parent, roots, depth + 1);
    }
}

fn inherits(name: &str, roots: &[PathBuf]) -> Vec<String> {
    for root in roots {
        let path = root.join(name).join("index.theme");
        let Ok(text) = fs::read_to_string(path) else { continue };
        for line in text.lines() {
            let Some((key, value)) = line.split_once('=') else { continue };
            if key.trim() != "Inherits" {
                continue;
            }
            return value
                .split(',')
                .map(str::trim)
                .filter(|theme| !theme.is_empty())
                .map(str::to_string)
                .collect();
        }
    }
    Vec::new()
}

fn exists(roots: &[PathBuf], name: &str) -> bool {
    roots.iter().any(|root| root.join(name).is_dir())
}

/// 主题名优先取 GTK 配置，其次 KDE 配置，最后问 GSettings。
fn active_theme() -> Option<String> {
    for version in ["gtk-3.0", "gtk-4.0"] {
        if let Some(name) = ini_value(&config_dir().join(version).join("settings.ini"), "gtk-icon-theme-name") {
            return Some(name);
        }
    }
    if let Some(name) = ini_value(&config_dir().join("kdeglobals"), "Theme") {
        return Some(name);
    }
    ffi::theme_name().filter(|name| !name.is_empty() && name != "hicolor")
}

fn ini_value(path: &Path, key: &str) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    for line in text.lines() {
        let Some((name, value)) = line.split_once('=') else { continue };
        if name.trim() == key {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn config_dir() -> PathBuf {
    match env::var_os("XDG_CONFIG_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => home().join(".config"),
    }
}

fn home() -> PathBuf {
    env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn icon_roots() -> Vec<PathBuf> {
    let home = home();
    let mut roots = vec![home.join(".icons"), home.join(".local/share/icons")];
    for dir in data_dirs() {
        let path = dir.join("icons");
        if !roots.contains(&path) {
            roots.push(path);
        }
    }
    roots
}

fn pixmap_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![home().join(".local/share/pixmaps")];
    for dir in data_dirs() {
        let path = dir.join("pixmaps");
        if !dirs.contains(&path) {
            dirs.push(path);
        }
    }
    dirs
}

fn data_dirs() -> Vec<PathBuf> {
    let value = env::var("XDG_DATA_DIRS").unwrap_or_default();
    let value = if value.trim().is_empty() { "/usr/local/share:/usr/share" } else { value.as_str() };
    value.split(':').filter(|dir| !dir.is_empty()).map(PathBuf::from).collect()
}
