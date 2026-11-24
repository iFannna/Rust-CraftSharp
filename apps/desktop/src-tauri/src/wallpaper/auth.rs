//! mcblock.top 登录态：只保存 NextAuth 会话 Cookie，DPAPI 加密落盘。

use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{OnceLock, RwLock};

use tauri::{AppHandle, Manager};

const FILE: &str = "wallpaper-session.bin";

static SESSION: OnceLock<RwLock<Option<String>>> = OnceLock::new();
/// 每次退出登录自增，抓取结果回来时不匹配就丢弃
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn slot() -> &'static RwLock<Option<String>> {
    SESSION.get_or_init(|| RwLock::new(None))
}

pub fn cookie() -> Option<String> {
    slot().read().ok().and_then(|value| value.clone())
}

pub fn generation() -> u64 {
    GENERATION.load(Ordering::Relaxed)
}

pub fn logged_in() -> bool {
    cookie().is_some()
}

fn path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(FILE))
        .map_err(|error| error.to_string())
}

pub fn load(app: &AppHandle) {
    let Ok(file) = path(app) else { return };
    let Ok(bytes) = fs::read(file) else { return };
    let Ok(value) = unprotect(&bytes) else { return };
    if let Ok(mut slot) = slot().write() {
        *slot = Some(value);
    }
}

pub fn save(app: &AppHandle, cookie: &str) -> Result<(), String> {
    if cookie.trim().is_empty() {
        return Err("登录信息为空".into());
    }
    let file = path(app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let encrypted = protect(cookie)?;
    fs::write(&file, encrypted).map_err(|error| format!("保存登录信息失败：{error}"))?;
    // Linux 没有 DPAPI，会话文件只对当前用户可读
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&file, fs::Permissions::from_mode(0o600));
    }
    if let Ok(mut slot) = slot().write() {
        *slot = Some(cookie.to_string());
    }
    Ok(())
}

pub fn clear(app: &AppHandle) {
    GENERATION.fetch_add(1, Ordering::Relaxed);
    if let Ok(file) = path(app) {
        let _ = fs::remove_file(file);
    }
    if let Ok(mut slot) = slot().write() {
        *slot = None;
    }
}

#[cfg(windows)]
#[repr(C)]
struct DataBlob {
    size: u32,
    data: *mut u8,
}

#[cfg(windows)]
fn protect(value: &str) -> Result<Vec<u8>, String> {
    unsafe_protect(value.as_bytes()).map_err(|_| "加密登录信息失败".into())
}

#[cfg(windows)]
fn unprotect(bytes: &[u8]) -> Result<String, String> {
    let data = unsafe_unprotect(bytes).map_err(|_| "读取登录信息失败".to_string())?;
    String::from_utf8(data).map_err(|_| "登录信息格式异常".into())
}

#[cfg(windows)]
fn unsafe_protect(bytes: &[u8]) -> Result<Vec<u8>, ()> {
    use std::ffi::c_void;

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            data_in: *const DataBlob,
            description: *const u16,
            entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(handle: isize) -> isize;
    }

    let input = DataBlob {
        size: bytes.len() as u32,
        data: bytes.as_ptr() as *mut u8,
    };
    let mut output = DataBlob {
        size: 0,
        data: std::ptr::null_mut(),
    };
    // SAFETY: 输入输出缓冲区在调用期间有效，输出由 LocalFree 释放
    unsafe {
        if CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        ) == 0
        {
            return Err(());
        }
        let result = std::slice::from_raw_parts(output.data, output.size as usize).to_vec();
        LocalFree(output.data as isize);
        Ok(result)
    }
}

#[cfg(windows)]
fn unsafe_unprotect(bytes: &[u8]) -> Result<Vec<u8>, ()> {
    use std::ffi::c_void;

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptUnprotectData(
            data_in: *const DataBlob,
            description: *mut *mut u16,
            entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(handle: isize) -> isize;
    }

    let input = DataBlob {
        size: bytes.len() as u32,
        data: bytes.as_ptr() as *mut u8,
    };
    let mut output = DataBlob {
        size: 0,
        data: std::ptr::null_mut(),
    };
    // SAFETY: 输入输出缓冲区在调用期间有效，输出由 LocalFree 释放
    unsafe {
        if CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        ) == 0
        {
            return Err(());
        }
        let result = std::slice::from_raw_parts(output.data, output.size as usize).to_vec();
        LocalFree(output.data as isize);
        Ok(result)
    }
}

#[cfg(not(windows))]
fn protect(value: &str) -> Result<Vec<u8>, String> {
    Ok(value.as_bytes().to_vec())
}

#[cfg(not(windows))]
fn unprotect(bytes: &[u8]) -> Result<String, String> {
    String::from_utf8(bytes.to_vec()).map_err(|_| "登录信息格式异常".into())
}
