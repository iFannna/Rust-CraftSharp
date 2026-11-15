#![allow(non_snake_case)]

//! 桌面文件操作：打开、定位、管理员运行、剪贴板、回收站删除、重命名。

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

const SW_SHOWNORMAL: i32 = 1;

#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        hwnd: isize,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show: i32,
    ) -> isize;
    fn DragQueryFileW(drop: isize, index: u32, file: *mut u16, chars: u32) -> u32;
}

#[link(name = "user32")]
extern "system" {
    fn OpenClipboard(owner: isize) -> i32;
    fn CloseClipboard() -> i32;
    fn EmptyClipboard() -> i32;
    fn GetClipboardData(format: u32) -> isize;
    fn SetClipboardData(format: u32, handle: isize) -> isize;
    fn IsClipboardFormatAvailable(format: u32) -> i32;
    fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, flags: u32) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn GlobalAlloc(flags: u32, bytes: usize) -> isize;
    fn GlobalFree(handle: isize) -> isize;
    fn GlobalLock(handle: isize) -> *mut c_void;
    fn GlobalUnlock(handle: isize) -> i32;
    fn GlobalSize(handle: isize) -> usize;
}

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(hwnd: isize, attribute: u32, value: *const c_void, size: u32) -> i32;
}

const CF_UNICODETEXT: u32 = 13;
const CF_HDROP: u32 = 15;
const GMEM_MOVEABLE: u32 = 0x0002;
const MB_YESNO: u32 = 0x0004;
const MB_ICONQUESTION: u32 = 0x0020;
const MB_ICONWARNING: u32 = 0x0030;
const MB_TOPMOST: u32 = 0x0004_0000;
const IDYES: i32 = 6;
// dwmapi.h 中 NCRENDERING_POLICY 是 2，TRANSITIONS_FORCEDISABLED 是 3，写错 2 会关掉非客户区渲染
const DWMWA_TRANSITIONS_FORCEDISABLED: u32 = 3;

/// 原生确认框，隐藏的 WebView 里也能正常显示。
pub fn confirm(text: &str) -> bool {
    let title = wide("CraftSharp");
    let body = wide(text);
    // SAFETY: 文本缓冲区在调用期间有效，对话框是同步的
    unsafe { MessageBoxW(0, body.as_ptr(), title.as_ptr(), MB_YESNO | MB_ICONQUESTION | MB_TOPMOST) == IDYES }
}

/// 原生提示框，用于重命名冲突等失败信息。
pub fn alert(text: &str) {
    let title = wide("CraftSharp");
    let body = wide(text);
    // SAFETY: 同上
    unsafe {
        MessageBoxW(0, body.as_ptr(), title.as_ptr(), MB_ICONWARNING | MB_TOPMOST);
    }
}

/// 关闭窗口显隐时的 DWM 过渡，让 MC 窗口和快捷栏一样直接出现。
pub fn disable_transitions(hwnd: isize) {
    let value: i32 = 1;
    // SAFETY: 只设置窗口属性，失败也不影响功能
    unsafe {
        DwmSetWindowAttribute(hwnd, DWMWA_TRANSITIONS_FORCEDISABLED, &value as *const i32 as *const c_void, 4);
    }
}

fn wide(value: &str) -> Vec<u16> {
    Path::new(value)
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn shell_execute(operation: &str, file: &str, parameters: Option<&str>) -> Result<(), String> {
    let operation = wide(operation);
    let file = wide(file);
    let parameters = parameters.map(wide);

    let result = unsafe {
        ShellExecuteW(
            0,
            operation.as_ptr(),
            file.as_ptr(),
            parameters.as_ref().map(|value| value.as_ptr()).unwrap_or(std::ptr::null()),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };

    // ShellExecuteW 返回值大于 32 才算成功
    if result as usize > 32 {
        Ok(())
    } else {
        Err(format!("ShellExecuteW 失败：{}", result as usize))
    }
}

pub fn open(path: &str) -> Result<(), String> {
    shell_execute("open", path, None)
}

pub fn reveal(path: &str) -> Result<(), String> {
    shell_execute("open", "explorer.exe", Some(&format!("/select,\"{}\"", path)))
}

pub fn run_as_admin(path: &str) -> Result<(), String> {
    shell_execute("runas", path, None)
}

pub fn exists(path: &str) -> bool {
    Path::new(path).exists()
}

pub fn rename(from: &str, to: &str) -> Result<(), String> {
    std::fs::rename(from, to).map_err(|error| error.to_string())
}

pub fn copy_text(text: &str) -> Result<(), String> {
    let mut buffer: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = buffer.len() * 2;

    unsafe {
        if OpenClipboard(0) == 0 {
            return Err("无法打开剪贴板".into());
        }

        let result = (|| {
            if EmptyClipboard() == 0 {
                return Err("无法清空剪贴板".into());
            }

            let handle = GlobalAlloc(GMEM_MOVEABLE, bytes);
            if handle == 0 {
                return Err("无法分配剪贴板内存".into());
            }

            let memory = GlobalLock(handle) as *mut u16;
            if memory.is_null() {
                GlobalFree(handle);
                return Err("无法锁定剪贴板内存".into());
            }

            std::ptr::copy_nonoverlapping(buffer.as_ptr(), memory, buffer.len());
            GlobalUnlock(handle);

            if SetClipboardData(CF_UNICODETEXT, handle) == 0 {
                GlobalFree(handle);
                return Err("写入剪贴板失败".into());
            }

            Ok(())
        })();

        CloseClipboard();
        buffer.clear();
        result
    }
}

pub fn read_text() -> Option<String> {
    unsafe {
        if OpenClipboard(0) == 0 {
            return None;
        }

        let mut text = None;

        if IsClipboardFormatAvailable(CF_UNICODETEXT) != 0 {
            let handle = GetClipboardData(CF_UNICODETEXT);
            if handle != 0 {
                let memory = GlobalLock(handle) as *const u16;
                if !memory.is_null() {
                    let size = GlobalSize(handle) / 2;
                    let slice = std::slice::from_raw_parts(memory, size);
                    let length = slice.iter().position(|unit| *unit == 0).unwrap_or(slice.len());
                    text = Some(String::from_utf16_lossy(&slice[..length]));
                    GlobalUnlock(handle);
                }
            }
        }

        CloseClipboard();
        text
    }
}

/// 读取剪贴板中第一个文件路径（CF_HDROP），没有则回退到文本路径
pub fn read_file_paths() -> Vec<String> {
    let mut paths = Vec::new();

    unsafe {
        if OpenClipboard(0) != 0 {
            if IsClipboardFormatAvailable(CF_HDROP) != 0 {
                let drop = GetClipboardData(CF_HDROP);
                if drop != 0 {
                    let count = DragQueryFileW(drop, u32::MAX, std::ptr::null_mut(), 0);
                    for index in 0..count {
                        let length = DragQueryFileW(drop, index, std::ptr::null_mut(), 0) as usize;
                        let mut buffer = vec![0u16; length + 1];
                        if DragQueryFileW(drop, index, buffer.as_mut_ptr(), buffer.len() as u32) > 0 {
                            let end = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
                            paths.push(String::from_utf16_lossy(&buffer[..end]));
                        }
                    }
                }
            }
            CloseClipboard();
        }
    }

    if paths.is_empty() {
        if let Some(text) = read_text() {
            let trimmed = text.trim().trim_matches('"').to_string();
            if !trimmed.is_empty() && Path::new(&trimmed).exists() {
                paths.push(trimmed);
            }
        }
    }

    paths
}
