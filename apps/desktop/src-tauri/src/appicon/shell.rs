//! 快捷方式图标同步、Shell 图标缓存刷新与管理员提权启动。

use std::ffi::c_void;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use crate::icons::{set_shortcut_icon, shortcut_target};

const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
const SHCNE_UPDATEITEM: i32 = 0x0000_2000;
const SHCNF_IDLIST: u32 = 0;
const SHCNF_PATHW: u32 = 0x0005;
const SEE_MASK_NOCLOSEPROCESS: u32 = 0x40;
const SEE_MASK_FLAG_NO_UI: u32 = 0x400;
const SW_SHOWNORMAL: i32 = 1;
const INFINITE: u32 = 0xFFFF_FFFF;
const ERROR_CANCELLED: i32 = 1223;

#[repr(C)]
struct ShellExecuteInfoW {
    cb_size: u32,
    f_mask: u32,
    hwnd: isize,
    lp_verb: *const u16,
    lp_file: *const u16,
    lp_parameters: *const u16,
    lp_directory: *const u16,
    n_show: i32,
    h_inst_app: isize,
    lp_id_list: *mut c_void,
    lp_class: *const u16,
    hkey_class: isize,
    dw_hot_key: u32,
    h_icon: isize,
    h_process: isize,
}

#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteExW(info: *mut ShellExecuteInfoW) -> i32;
    fn SHChangeNotify(event: i32, flags: u32, item1: *const c_void, item2: *const c_void);
}

#[link(name = "kernel32")]
extern "system" {
    fn WaitForSingleObject(handle: isize, milliseconds: u32) -> u32;
    fn GetExitCodeProcess(handle: isize, code: *mut u32) -> i32;
    fn CloseHandle(handle: isize) -> i32;
}

#[link(name = "ole32")]
extern "system" {
    fn CoInitializeEx(reserved: *mut c_void, coinit: u32) -> i32;
    fn CoUninitialize();
}

const COINIT_APARTMENTTHREADED: u32 = 0x2;

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

fn normalized(path: &Path) -> String {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    canonical
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .trim()
        .to_lowercase()
}

fn shortcut_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(profile) = std::env::var("USERPROFILE") {
        dirs.push(PathBuf::from(&profile).join("Desktop"));
    }
    if let Ok(public) = std::env::var("PUBLIC") {
        dirs.push(PathBuf::from(&public).join("Desktop"));
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        dirs.push(PathBuf::from(&appdata).join("Microsoft\\Windows\\Start Menu\\Programs"));
        dirs.push(
            PathBuf::from(&appdata)
                .join("Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar"),
        );
    }
    if let Ok(programdata) = std::env::var("PROGRAMDATA") {
        dirs.push(PathBuf::from(&programdata).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }
    dirs
}

fn walk(dir: &Path, depth: usize, visit: &mut impl FnMut(&Path)) {
    if depth > 6 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, depth + 1, visit);
        } else if path
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("lnk"))
            .unwrap_or(false)
        {
            visit(&path);
        }
    }
}

/// 把指向当前程序的快捷方式图标位置改为当前 exe
pub fn update_shortcuts(exe: &Path) {
    let target = normalized(exe);
    let icon = format!("{},0", exe.display());

    for dir in shortcut_dirs() {
        walk(&dir, 0, &mut |path| {
            let Some(path_text) = path.to_str() else { return };
            let Some(link_target) = shortcut_target(path_text) else { return };
            if normalized(Path::new(&link_target)) == target {
                set_shortcut_icon(path_text, &icon);
            }
        });
    }
    refresh();
}

/// 通知资源管理器刷新单个文件的图标缓存
pub fn notify_file(path: &Path) {
    let wide = wide_path(path);
    unsafe {
        SHChangeNotify(
            SHCNE_UPDATEITEM,
            SHCNF_PATHW,
            wide.as_ptr() as *const c_void,
            std::ptr::null(),
        );
    }
}

/// 通知资源管理器刷新文件与快捷方式图标
pub fn refresh() {
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
    }
}

/// 以管理员身份重新运行当前程序完成补丁；返回 "canceled" 表示用户取消
pub fn apply_elevated(ico: &[u8], dir: &Path, exe: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let ico_path = dir.join("app-icon-pending.ico");
    let result_path = dir.join("app-icon-result.txt");
    std::fs::write(&ico_path, ico).map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(&result_path);

    let params = format!(
        "\"--apply-icon\" \"{}\" \"{}\" \"{}\"",
        ico_path.display(),
        exe.display(),
        result_path.display()
    );
    let code = match run_as_admin(exe, &params) {
        Ok(code) => code,
        Err(error) => {
            let _ = std::fs::remove_file(&ico_path);
            let _ = std::fs::remove_file(&result_path);
            return Err(error);
        }
    };
    let result = std::fs::read_to_string(&result_path).unwrap_or_default();
    let _ = std::fs::remove_file(&ico_path);
    let _ = std::fs::remove_file(&result_path);

    if code == 0 && result.trim() == "ok" {
        return Ok(());
    }
    let detail = result.trim().strip_prefix("failed: ").unwrap_or(result.trim());
    if detail.is_empty() {
        Err("程序文件图标未更新".into())
    } else {
        Err(detail.to_string())
    }
}

fn run_as_admin(exe: &Path, params: &str) -> Result<u32, String> {
    let initialized = unsafe { CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED) } >= 0;
    let result = launch_elevated(exe, params);
    if initialized {
        unsafe {
            CoUninitialize();
        }
    }
    result
}

fn launch_elevated(exe: &Path, params: &str) -> Result<u32, String> {
    let verb = wide("runas");
    let file = wide_path(exe);
    let parameters = wide(params);

    let mut info: ShellExecuteInfoW = unsafe { std::mem::zeroed() };
    info.cb_size = std::mem::size_of::<ShellExecuteInfoW>() as u32;
    info.f_mask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI;
    info.lp_verb = verb.as_ptr();
    info.lp_file = file.as_ptr();
    info.lp_parameters = parameters.as_ptr();
    info.n_show = SW_SHOWNORMAL;

    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_CANCELLED) {
            return Err("canceled".into());
        }
        return Err(format!("无法以管理员身份启动：{error}"));
    }
    if info.h_process == 0 {
        return Err("无法等待管理员进程".into());
    }

    unsafe {
        WaitForSingleObject(info.h_process, INFINITE);
        let mut code = 1u32;
        GetExitCodeProcess(info.h_process, &mut code);
        CloseHandle(info.h_process);
        Ok(code)
    }
}
