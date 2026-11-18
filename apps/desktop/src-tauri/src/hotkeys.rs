//! 全局热键：Win32 RegisterHotKey + 独立消息线程，触发后向前端广播事件。

#![allow(non_snake_case)]

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

pub const EVENT_NAME: &str = "craftsharp-hotkey";
pub const FAILURES_EVENT: &str = "craftsharp-hotkey-failures";

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
/// 每个动作下标注册成功的组合，失败或未设置时为 None
static REGISTERED: Mutex<Vec<Option<String>>> = Mutex::new(Vec::new());
/// Win32 注册 ID 与组合的对应，同一组合只注册一次
static BINDINGS: Mutex<Vec<(u32, String)>> = Mutex::new(Vec::new());
static FAILURES: Mutex<Vec<String>> = Mutex::new(Vec::new());
static THREAD_ID: AtomicU32 = AtomicU32::new(0);
static APP: OnceLock<AppHandle> = OnceLock::new();

/// 注册一批热键，下标即热键 id；失败项通过事件和查询命令回传。
pub fn register(app: &AppHandle, actions: Vec<String>) {
    let _ = APP.set(app.clone());

    if let Ok(mut pending) = PENDING.lock() {
        *pending = actions;
    }

    let thread_id = THREAD_ID.load(Ordering::SeqCst);
    if thread_id == 0 {
        spawn_thread(app.clone());
        return;
    }

    unsafe {
        PostThreadMessageW(thread_id, WM_APP_RELOAD, 0, 0);
    }
}

/// 最近一次注册失败的组合，供快捷键页初始化。
pub fn failures() -> Vec<String> {
    FAILURES.lock().map(|list| list.clone()).unwrap_or_default()
}

fn spawn_thread(app: AppHandle) {
    std::thread::spawn(move || {
        THREAD_ID.store(unsafe { GetCurrentThreadId() }, Ordering::SeqCst);
        apply_hotkeys(&app);

        loop {
            let mut msg: Msg = unsafe { std::mem::zeroed() };
            let result = unsafe { GetMessageW(&mut msg, 0, 0, 0) };
            if result <= 0 {
                break;
            }

            match msg.message {
                WM_HOTKEY => emit_actions(&app, msg.wparam as u32),
                WM_APP_RELOAD => {
                    apply_hotkeys(&app);
                }
                _ => {}
            }
        }
    });
}

/// 同一组合可能对应多个动作，逐个广播动作下标
fn emit_actions(app: &AppHandle, id: u32) {
    let spec = BINDINGS
        .lock()
        .ok()
        .and_then(|bindings| bindings.iter().find(|(binding, _)| *binding == id).map(|(_, spec)| spec.clone()));
    let Some(spec) = spec else { return };

    let Ok(registered) = REGISTERED.lock() else { return };
    for (index, action) in registered.iter().enumerate() {
        if action.as_deref() == Some(spec.as_str()) {
            let _ = app.emit(EVENT_NAME, index);
        }
    }
}

fn apply_hotkeys(app: &AppHandle) {
    let actions = PENDING.lock().map(|pending| pending.clone()).unwrap_or_default();

    if let Ok(bindings) = BINDINGS.lock() {
        for (id, _) in bindings.iter() {
            unsafe {
                UnregisterHotKey(0, *id as i32);
            }
        }
    }

    let mut bindings: Vec<(u32, String)> = Vec::new();
    let mut registered: Vec<Option<String>> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for action in actions.iter() {
        if action.trim().is_empty() {
            registered.push(None);
            continue;
        }
        if bindings.iter().any(|(_, spec)| spec == action) {
            registered.push(Some(action.clone()));
            continue;
        }

        let ok = if let Some((modifiers, vk)) = parse_hotkey(action) {
            let id = bindings.len() as u32 + 1;
            let registered = unsafe { RegisterHotKey(0, id as i32, modifiers, vk) != 0 };
            if registered {
                bindings.push((id, action.clone()));
            }
            registered
        } else {
            false
        };

        registered.push(ok.then(|| action.clone()));
        if !ok && !failures.contains(action) {
            failures.push(action.clone());
        }
    }

    if let Ok(mut current) = BINDINGS.lock() {
        *current = bindings;
    }
    if let Ok(mut current) = REGISTERED.lock() {
        *current = registered;
    }
    if let Ok(mut current) = FAILURES.lock() {
        *current = failures.clone();
    }
    let _ = app.emit(FAILURES_EVENT, failures);
}

/// 解析 "Ctrl+Alt+E" 形式的热键，大小写不敏感。
fn parse_hotkey(spec: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = spec.split('+').map(|part| part.trim()).filter(|part| !part.is_empty()).collect();
    let key = parts.last()?;
    let mut modifiers = 0u32;

    for part in &parts[..parts.len() - 1] {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= MOD_CONTROL,
            "alt" => modifiers |= MOD_ALT,
            "shift" => modifiers |= MOD_SHIFT,
            "win" | "super" | "meta" => modifiers |= MOD_WIN,
            _ => return None,
        }
    }

    // 单键不加 MOD_NOREPEAT，与老版注册保持一致
    if modifiers != 0 {
        modifiers |= MOD_NOREPEAT;
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

    if let Some(number) = upper.strip_prefix("NUM") {
        if let Ok(index) = number.parse::<u32>() {
            if index <= 9 {
                return Some(0x60 + index);
            }
        }
    }

    match upper.as_str() {
        "SPACE" => Some(0x20),
        "TAB" => Some(0x09),
        "ENTER" | "RETURN" | "NUMENTER" => Some(0x0D),
        "ESC" | "ESCAPE" => Some(0x1B),
        "LEFT" => Some(0x25),
        "UP" => Some(0x26),
        "RIGHT" => Some(0x27),
        "DOWN" => Some(0x28),
        "HOME" => Some(0x24),
        "END" => Some(0x23),
        "PAGEUP" => Some(0x21),
        "PAGEDOWN" => Some(0x22),
        "INSERT" => Some(0x2D),
        "DELETE" => Some(0x2E),
        "BACKSPACE" => Some(0x08),
        "MINUS" | "-" => Some(0xBD),
        "EQUAL" | "=" => Some(0xBB),
        "BACKQUOTE" | "`" => Some(0xC0),
        "BRACKETLEFT" | "[" => Some(0xDB),
        "BRACKETRIGHT" | "]" => Some(0xDD),
        "BACKSLASH" | "\\" => Some(0xDC),
        "SEMICOLON" | ";" => Some(0xBA),
        "QUOTE" | "'" => Some(0xDE),
        "COMMA" | "," => Some(0xBC),
        "PERIOD" | "." => Some(0xBE),
        "SLASH" | "/" => Some(0xBF),
        "NUMPLUS" => Some(0x6B),
        "NUMMINUS" => Some(0x6D),
        "NUMMULTIPLY" => Some(0x6A),
        "NUMDIVIDE" => Some(0x6F),
        "NUMDECIMAL" => Some(0x6E),
        _ => None,
    }
}
