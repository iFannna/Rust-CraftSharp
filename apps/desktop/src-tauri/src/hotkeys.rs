//! 全局热键：Win32 RegisterHotKey + 独立消息线程，触发后向前端广播事件。

#![allow(non_snake_case)]

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

pub const EVENT_NAME: &str = "craftsharp-hotkey";

const MOD_ALT: u32 = 0x0001;
const MOD_CONTROL: u32 = 0x0002;
const MOD_SHIFT: u32 = 0x0004;
const MOD_WIN: u32 = 0x0008;
const MOD_NOREPEAT: u32 = 0x4000;

const WM_HOTKEY: u32 = 0x0312;
const WM_APP_RELOAD: u32 = 0x8001;

#[repr(C)]
struct Msg {
    hwnd: isize,
    message: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    pt_x: i32,
    pt_y: i32,
    private: u32,
}

#[link(name = "user32")]
extern "system" {
    fn RegisterHotKey(hwnd: isize, id: i32, modifiers: u32, vk: u32) -> i32;
    fn UnregisterHotKey(hwnd: isize, id: i32) -> i32;
    fn GetMessageW(msg: *mut Msg, hwnd: isize, min: u32, max: u32) -> i32;
    fn PostThreadMessageW(thread_id: u32, msg: u32, wparam: usize, lparam: isize) -> i32;
    fn GetCurrentThreadId() -> u32;
}

static PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());
static REGISTERED: Mutex<Vec<Option<String>>> = Mutex::new(Vec::new());
static THREAD_ID: AtomicU32 = AtomicU32::new(0);
static APP: OnceLock<AppHandle> = OnceLock::new();

/// 注册一批热键，下标即热键 id，返回注册失败的原始描述。
pub fn register(app: &AppHandle, actions: Vec<String>) -> Vec<String> {
    let _ = APP.set(app.clone());

    if let Ok(mut pending) = PENDING.lock() {
        *pending = actions;
    }

    let thread_id = THREAD_ID.load(Ordering::SeqCst);
    if thread_id == 0 {
        spawn_thread(app.clone());
        return Vec::new();
    }

    unsafe {
        PostThreadMessageW(thread_id, WM_APP_RELOAD, 0, 0);
    }

    Vec::new()
}

fn spawn_thread(app: AppHandle) {
    std::thread::spawn(move || {
        THREAD_ID.store(unsafe { GetCurrentThreadId() }, Ordering::SeqCst);

        let failures = apply_hotkeys(&app);
        for spec in &failures {
            eprintln!("热键注册失败: {spec}");
        }

        loop {
            let mut msg: Msg = unsafe { std::mem::zeroed() };
            let result = unsafe { GetMessageW(&mut msg, 0, 0, 0) };
            if result <= 0 {
                break;
            }

            match msg.message {
                WM_HOTKEY => {
                    let id = msg.wparam;
                    if let Ok(registered) = REGISTERED.lock() {
                        if let Some(Some(action)) = registered.get(id) {
                            let _ = app.emit(EVENT_NAME, action.clone());
                        }
                    }
                }
                WM_APP_RELOAD => {
                    let failures = apply_hotkeys(&app);
                    for spec in &failures {
                        eprintln!("热键注册失败: {spec}");
                    }
                }
                _ => {}
            }
        }
    });
}

fn apply_hotkeys(app: &AppHandle) -> Vec<String> {
    let actions = PENDING.lock().map(|pending| pending.clone()).unwrap_or_default();

    if let Ok(registered) = REGISTERED.lock() {
        for (index, action) in registered.iter().enumerate() {
            if action.is_some() {
                unsafe {
                    UnregisterHotKey(0, index as i32);
                }
            }
        }
    }

    let mut registered: Vec<Option<String>> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for (index, action) in actions.iter().enumerate() {
        match parse_hotkey(action) {
            Some((modifiers, vk)) => {
                let ok = unsafe { RegisterHotKey(0, index as i32, modifiers, vk) } != 0;
                if ok {
                    registered.push(Some(action.clone()));
                } else {
                    registered.push(None);
                    failures.push(action.clone());
                }
            }
            None => {
                registered.push(None);
                if !action.trim().is_empty() {
                    failures.push(action.clone());
                }
            }
        }
    }

    if let Ok(mut current) = REGISTERED.lock() {
        *current = registered;
    }

    let _ = app;
    failures
}

/// 解析 "Ctrl+Alt+E" 形式的热键，大小写不敏感。
fn parse_hotkey(spec: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = spec.split('+').map(|part| part.trim()).filter(|part| !part.is_empty()).collect();
    let key = parts.last()?;
    let mut modifiers = MOD_NOREPEAT;

    for part in &parts[..parts.len() - 1] {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= MOD_CONTROL,
            "alt" => modifiers |= MOD_ALT,
            "shift" => modifiers |= MOD_SHIFT,
            "win" | "super" | "meta" => modifiers |= MOD_WIN,
            _ => return None,
        }
    }

    Some((modifiers, virtual_key(key)?))
}

fn virtual_key(key: &str) -> Option<u32> {
    let upper = key.to_ascii_uppercase();

    if upper.len() == 1 {
        let ch = upper.chars().next()?;
        if ch.is_ascii_alphanumeric() {
            return Some(ch as u32);
        }
    }

    if let Some(number) = upper.strip_prefix('F') {
        if let Ok(index) = number.parse::<u32>() {
            if (1..=24).contains(&index) {
                return Some(0x70 + index - 1);
            }
        }
    }

    match upper.as_str() {
        "SPACE" => Some(0x20),
        "TAB" => Some(0x09),
        "ENTER" | "RETURN" => Some(0x0D),
        "ESC" | "ESCAPE" => Some(0x1B),
        "LEFT" => Some(0x25),
        "UP" => Some(0x26),
        "RIGHT" => Some(0x27),
        "DOWN" => Some(0x28),
        "HOME" => Some(0x24),
        "END" => Some(0x23),
        "INSERT" => Some(0x2D),
        "DELETE" => Some(0x2E),
        "BACKSPACE" => Some(0x08),
        "MINUS" | "-" => Some(0xBD),
        "EQUAL" | "=" => Some(0xBB),
        _ => None,
    }
}
