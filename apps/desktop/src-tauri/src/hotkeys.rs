//! 全局热键：按键统一还原左右修饰键，有序序列最多三键，全部松开后匹配并广播动作。
//! 前台窗口属于本进程时钩子让路，由该窗口自己的输入路径处理。

#![allow(non_snake_case)]

#[cfg(windows)]
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

pub const EVENT_NAME: &str = "craftsharp-hotkey";
pub const FAILURES_EVENT: &str = "craftsharp-hotkey-failures";
pub(crate) const MAX_SEQUENCE: usize = 3;

const WM_KEYDOWN: u32 = 0x0100;
const WM_KEYUP: u32 = 0x0101;
const WM_SYSKEYDOWN: u32 = 0x0104;
const WM_SYSKEYUP: u32 = 0x0105;
const WH_KEYBOARD_LL: i32 = 13;
/// KBDLLHOOKSTRUCT.flags 的扩展键位，用于区分右侧 Ctrl/Alt
pub(crate) const LLKHF_EXTENDED: u32 = 0x01;

#[cfg(windows)]
#[repr(C)]
#[allow(dead_code)]
struct KeyboardHookData {
    vk_code: u32,
    scan_code: u32,
    flags: u32,
    time: u32,
    extra_info: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ModBase {
    Ctrl,
    Shift,
    Alt,
    Win,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct ModKey {
    base: ModBase,
    /// Some(true) 左键，Some(false) 右键，None 表示任意一侧
    side: Option<bool>,
}

#[derive(Clone, Copy)]
enum HookKey {
    Mod(ModKey),
    Vk(u32),
}

struct HookBinding {
    spec: String,
    keys: Vec<HookKey>,
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn SetWindowsHookExW(
        id_hook: i32,
        proc: Option<unsafe extern "system" fn(i32, usize, isize) -> isize>,
        hmod: isize,
        thread_id: u32,
    ) -> isize;
    fn CallNextHookEx(hook: isize, code: i32, wparam: usize, lparam: isize) -> isize;
    fn GetAsyncKeyState(vk: i32) -> i16;
    fn GetForegroundWindow() -> isize;
    fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentProcessId() -> u32;
}

#[cfg(windows)]
static PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// 每个动作下标当前生效的组合，未设置或解析失败时为 None
static REGISTERED: Mutex<Vec<Option<String>>> = Mutex::new(Vec::new());
#[cfg(windows)]
static FAILURES: Mutex<Vec<String>> = Mutex::new(Vec::new());
static APP: OnceLock<AppHandle> = OnceLock::new();

/// 录制暂停时清空，匹配不到任何序列
static HOOK_BINDINGS: Mutex<Vec<HookBinding>> = Mutex::new(Vec::new());
#[cfg(windows)]
static HOOK_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static HOOK: AtomicIsize = AtomicIsize::new(0);
/// 当前按住的虚拟键，用于自动重复抑制与松开判定
#[cfg(windows)]
static HOOK_DOWN: Mutex<Vec<u32>> = Mutex::new(Vec::new());
/// 本次按下的顺序序列，最多三键
#[cfg(windows)]
static HOOK_SEQUENCE: Mutex<Vec<HookKey>> = Mutex::new(Vec::new());
#[cfg(windows)]
static HOOK_OVERFLOW: AtomicBool = AtomicBool::new(false);

/// 注册一批热键，下标即热键 id；失败项通过事件和查询命令回传。
#[cfg(windows)]
pub fn register(app: &AppHandle, actions: Vec<String>) {
    let _ = APP.set(app.clone());

    if let Ok(mut pending) = PENDING.lock() {
        *pending = actions;
    }

    // 钩子挂在主线程的消息循环上，WebView 聚焦时也能稳定回调
    if HOOK.load(Ordering::SeqCst) == 0 {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if HOOK.load(Ordering::SeqCst) == 0 {
                unsafe {
                    let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), 0, 0);
                    if hook != 0 {
                        HOOK.store(hook, Ordering::SeqCst);
                    } else {
                        eprintln!("全局快捷键钩子安装失败 {:?}", std::io::Error::last_os_error());
                    }
                }
            }
            apply_hotkeys(&handle);
        });
        return;
    }

    apply_hotkeys(app);
}

/// 最近一次解析失败的组合，供快捷键页初始化。
#[cfg(windows)]
pub fn failures() -> Vec<String> {
    FAILURES.lock().map(|list| list.clone()).unwrap_or_default()
}

fn emit_spec(spec: &str) {
    let Some(app) = APP.get() else { return };
    let Ok(registered) = REGISTERED.lock() else { return };
    for (index, action) in registered.iter().enumerate() {
        if action.as_deref() == Some(spec) {
            let _ = app.emit(EVENT_NAME, index);
        }
    }
}

/// 前台窗口属于本进程时由窗口自己的输入路径处理，钩子让路，避免重复触发
#[cfg(windows)]
fn foreground_is_app() -> bool {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd == 0 {
        return false;
    }
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    pid != 0 && pid == unsafe { GetCurrentProcessId() }
}

/// 钩子与窗口消息里的修饰键只有通用码，按扫描码和扩展位还原左右
pub(crate) fn normalized_key(vk: u32, scan: u32, extended: bool) -> u32 {
    match vk {
        0x10 => {
            if scan & 0xff == 0x36 {
                0xA1
            } else {
                0xA0
            }
        }
        0x11 => {
            if extended {
                0xA3
            } else {
                0xA2
            }
        }
        0x12 => {
            if extended {
                0xA5
            } else {
                0xA4
            }
        }
        _ => vk,
    }
}

/// 从窗口按键消息的 lParam 还原左右明确的虚拟键码
pub(crate) fn key_from_message(wparam: usize, lparam: isize) -> u32 {
    let scan = ((lparam >> 16) & 0xff) as u32;
    let extended = (lparam >> 24) & 1 != 0;
    normalized_key(wparam as u32, scan, extended)
}

/// 原生窗口自己收到按键时，全部松开后按当前绑定广播全局动作
pub(crate) fn dispatch(tap: &[u32], overflow: bool) {
    if overflow || tap.is_empty() {
        return;
    }
    let keys: Vec<HookKey> = tap.iter().map(|vk| hook_key_of(*vk)).collect();
    let specs: Vec<String> = match HOOK_BINDINGS.lock() {
        Ok(bindings) => bindings
            .iter()
            .filter(|binding| binding_matches(binding, &keys))
            .map(|binding| binding.spec.clone())
            .collect(),
        Err(_) => Vec::new(),
    };
    for spec in specs {
        emit_spec(&spec);
    }
}

#[cfg(windows)]
unsafe extern "system" fn keyboard_hook(code: i32, wparam: usize, lparam: isize) -> isize {
    if code >= 0 && !foreground_is_app() && HOOK_ACTIVE.load(Ordering::Relaxed) {
        let data = &*(lparam as *const KeyboardHookData);
        let vk = normalized_key(data.vk_code, data.scan_code, data.flags & LLKHF_EXTENDED != 0);
        match wparam as u32 {
            WM_KEYDOWN | WM_SYSKEYDOWN => on_hook_down(vk),
            WM_KEYUP | WM_SYSKEYUP => on_hook_up(vk),
            _ => {}
        }
    }
    // 钩子只负责触发，不拦截系统与应用的按键
    CallNextHookEx(HOOK.load(Ordering::SeqCst), code, wparam, lparam)
}

#[cfg(windows)]
fn on_hook_down(vk: u32) {
    let fresh = {
        let Ok(mut down) = HOOK_DOWN.lock() else { return };
        if down.contains(&vk) {
            return;
        }
        let fresh = down.is_empty();
        down.push(vk);
        fresh
    };

    if fresh {
        if let Ok(mut sequence) = HOOK_SEQUENCE.lock() {
            sequence.clear();
        }
        HOOK_OVERFLOW.store(false, Ordering::SeqCst);
    }

    let Ok(mut sequence) = HOOK_SEQUENCE.lock() else { return };
    if sequence.len() >= MAX_SEQUENCE {
        HOOK_OVERFLOW.store(true, Ordering::SeqCst);
        return;
    }
    sequence.push(hook_key_of(vk));
}

#[cfg(windows)]
fn on_hook_up(vk: u32) {
    let released = {
        let Ok(mut down) = HOOK_DOWN.lock() else { return };
        if !down.contains(&vk) {
            return;
        }
        down.retain(|item| *item != vk);
        down.is_empty()
    };

    if !released {
        return;
    }

    let sequence = HOOK_SEQUENCE.lock().map(|list| list.clone()).unwrap_or_default();
    let overflow = HOOK_OVERFLOW.swap(false, Ordering::SeqCst);

    if !overflow && !sequence.is_empty() {
        let specs: Vec<String> = match HOOK_BINDINGS.lock() {
            Ok(bindings) => bindings
                .iter()
                .filter(|binding| binding_matches(binding, &sequence))
                .map(|binding| binding.spec.clone())
                .collect(),
            Err(_) => Vec::new(),
        };
        for spec in specs {
            emit_spec(&spec);
        }
    }

    if let Ok(mut list) = HOOK_SEQUENCE.lock() {
        list.clear();
    }
}

fn mod_of(vk: u32) -> Option<ModKey> {
    let (base, left) = match vk {
        0xA2 => (ModBase::Ctrl, true),
        0xA3 => (ModBase::Ctrl, false),
        0xA0 => (ModBase::Shift, true),
        0xA1 => (ModBase::Shift, false),
        0xA4 => (ModBase::Alt, true),
        0xA5 => (ModBase::Alt, false),
        0x5B => (ModBase::Win, true),
        0x5C => (ModBase::Win, false),
        0x11 => (ModBase::Ctrl, true),
        0x10 => (ModBase::Shift, true),
        0x12 => (ModBase::Alt, true),
        _ => return None,
    };
    Some(ModKey { base, side: Some(left) })
}

fn hook_key_of(vk: u32) -> HookKey {
    mod_of(vk).map(HookKey::Mod).unwrap_or(HookKey::Vk(vk))
}

fn key_matches(target: &HookKey, actual: &HookKey) -> bool {
    match (target, actual) {
        (HookKey::Mod(target), HookKey::Mod(actual)) => {
            target.base == actual.base && target.side.map_or(true, |side| actual.side == Some(side))
        }
        (HookKey::Vk(target), HookKey::Vk(actual)) => target == actual,
        _ => false,
    }
}

fn binding_matches(binding: &HookBinding, sequence: &[HookKey]) -> bool {
    binding.keys.len() == sequence.len()
        && binding
            .keys
            .iter()
            .zip(sequence)
            .all(|(target, actual)| key_matches(target, actual))
}

#[cfg(windows)]
fn apply_hotkeys(app: &AppHandle) {
    let actions = PENDING.lock().map(|pending| pending.clone()).unwrap_or_default();
    let hook_ready = HOOK.load(Ordering::SeqCst) != 0;

    let mut bindings: Vec<HookBinding> = Vec::new();
    let mut registered: Vec<Option<String>> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for action in actions.iter() {
        if action.trim().is_empty() {
            registered.push(None);
            continue;
        }

        if bindings.iter().any(|binding| binding.spec == action.as_str()) {
            registered.push(Some(action.clone()));
            continue;
        }

        match parse_sequence_spec(action) {
            Some(keys) if hook_ready => {
                bindings.push(HookBinding { spec: action.clone(), keys });
                registered.push(Some(action.clone()));
            }
            _ => {
                registered.push(None);
                if !failures.contains(action) {
                    failures.push(action.clone());
                }
            }
        }
    }

    HOOK_ACTIVE.store(!bindings.is_empty(), Ordering::SeqCst);
    if let Ok(mut current) = HOOK_BINDINGS.lock() {
        *current = bindings;
    }
    if let Ok(mut current) = REGISTERED.lock() {
        *current = registered;
    }
    if let Ok(mut current) = FAILURES.lock() {
        *current = failures.clone();
    }
    let _ = app.emit(FAILURES_EVENT, failures);

    reset_hook_state();
}

/// 配置重载时清空序列，并按物理按键重建修饰键，避免录制留下脏状态
#[cfg(windows)]
fn reset_hook_state() {
    if let Ok(mut sequence) = HOOK_SEQUENCE.lock() {
        sequence.clear();
    }
    HOOK_OVERFLOW.store(false, Ordering::SeqCst);

    let mut down = Vec::new();
    for vk in [0xA0u32, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C] {
        let pressed = (unsafe { GetAsyncKeyState(vk as i32) } as u16 & 0x8000) != 0;
        if pressed {
            down.push(vk);
        }
    }
    if let Ok(mut current) = HOOK_DOWN.lock() {
        *current = down;
    }
}

fn parse_sequence_spec(spec: &str) -> Option<Vec<HookKey>> {
    let parts: Vec<&str> = spec.split('+').map(str::trim).filter(|part| !part.is_empty()).collect();
    if parts.is_empty() || parts.len() > MAX_SEQUENCE {
        return None;
    }

    parts
        .iter()
        .map(|part| match parse_modifier(part) {
            Some(modifier) => Some(HookKey::Mod(modifier)),
            None => Some(HookKey::Vk(virtual_key(part)?)),
        })
        .collect()
}

fn parse_modifier(part: &str) -> Option<ModKey> {
    let lower = part.to_ascii_lowercase();
    let (side, name) = if let Some(rest) = lower.strip_prefix('l') {
        (Some(true), rest)
    } else if let Some(rest) = lower.strip_prefix('r') {
        (Some(false), rest)
    } else {
        (None, lower.as_str())
    };

    let base = match name {
        "ctrl" | "control" => ModBase::Ctrl,
        "shift" => ModBase::Shift,
        "alt" => ModBase::Alt,
        "win" | "super" | "meta" => ModBase::Win,
        _ => return None,
    };

    Some(ModKey { base, side })
}

/// 原生窗口内的局部序列：松开任一键结束当前序列
pub(crate) struct SequenceState {
    down: Vec<u32>,
    keys: Vec<u32>,
    /// 本次按下的完整顺序，松开后仍保留到全部松开再判定
    tap: Vec<u32>,
    overflow: bool,
    tap_overflow: bool,
    fired: bool,
}

impl SequenceState {
    pub const fn new() -> Self {
        Self {
            down: Vec::new(),
            keys: Vec::new(),
            tap: Vec::new(),
            overflow: false,
            tap_overflow: false,
            fired: false,
        }
    }

    /// 返回是否为新按下的键；自动重复返回 false，但仍可继续触发按住动作
    pub fn press(&mut self, vk: u32) -> bool {
        if self.down.contains(&vk) {
            return false;
        }
        if self.down.is_empty() {
            self.keys.clear();
            self.tap.clear();
            self.overflow = false;
            self.tap_overflow = false;
            self.fired = false;
        }
        self.down.push(vk);
        if self.keys.len() < MAX_SEQUENCE {
            self.keys.push(vk);
        } else {
            self.overflow = true;
        }
        if self.tap.len() < MAX_SEQUENCE {
            self.tap.push(vk);
        } else {
            self.tap_overflow = true;
        }
        true
    }

    /// 松开任一键即结束当前序列，按住动作随之停止
    pub fn release(&mut self, vk: u32) {
        if !self.down.contains(&vk) {
            return;
        }
        self.down.retain(|item| *item != vk);
        self.keys.clear();
        self.overflow = false;
        self.fired = false;
    }

    pub fn matches(&self, spec: &str) -> bool {
        !self.overflow && sequence_matches(spec, &self.keys)
    }

    pub fn tap(&self) -> &[u32] {
        &self.tap
    }

    pub fn tap_overflow(&self) -> bool {
        self.tap_overflow
    }

    pub fn is_empty(&self) -> bool {
        self.down.is_empty()
    }

    pub fn fired(&self) -> bool {
        self.fired
    }

    pub fn mark_fired(&mut self) {
        self.fired = true;
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }
}

/// 局部快捷键：按顺序比较按下序列；绑定没有侧别时任意一侧都算
pub(crate) fn sequence_matches(spec: &str, pressed: &[u32]) -> bool {
    let Some(binding) = parse_sequence_spec(spec) else { return false };
    binding.len() == pressed.len()
        && binding
            .iter()
            .zip(pressed)
            .all(|(target, vk)| key_matches(target, &hook_key_of(*vk)))
}

pub(crate) fn virtual_key(key: &str) -> Option<u32> {
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
        "NUMEQUAL" => Some(0x92),
        "NUMCOMMA" => Some(0x6E),
        "CAPSLOCK" => Some(0x14),
        "NUMLOCK" => Some(0x90),
        "SCROLLLOCK" => Some(0x91),
        "PRINTSCREEN" => Some(0x2C),
        "PAUSE" => Some(0x13),
        "CONTEXTMENU" => Some(0x5D),
        "VOLUMEMUTE" => Some(0xAD),
        "VOLUMEDOWN" => Some(0xAE),
        "VOLUMEUP" => Some(0xAF),
        "MEDIATRACKNEXT" => Some(0xB0),
        "MEDIATRACKPREVIOUS" => Some(0xB1),
        "MEDIASTOP" => Some(0xB2),
        "MEDIAPLAYPAUSE" => Some(0xB3),
        "LAUNCHMAIL" => Some(0xB4),
        "LAUNCHMEDIAPLAYER" => Some(0xB5),
        "LAUNCHAPP1" => Some(0xB6),
        "LAUNCHAPP2" => Some(0xB7),
        "BROWSERBACK" => Some(0xA6),
        "BROWSERFORWARD" => Some(0xA7),
        "BROWSERREFRESH" => Some(0xA8),
        "BROWSERSTOP" => Some(0xA9),
        "BROWSERSEARCH" => Some(0xAA),
        "BROWSERFAVORITES" => Some(0xAB),
        "BROWSERHOME" => Some(0xAC),
        "INTLBACKSLASH" => Some(0xE2),
        "INTLRO" => Some(0xC1),
        "INTLYEN" => Some(0xDC),
        "CONVERT" => Some(0x1C),
        "NONCONVERT" => Some(0x1D),
        "KANAMODE" => Some(0x15),
        "LANG1" => Some(0x94),
        "LANG2" => Some(0x95),
        "LANG3" => Some(0x96),
        "LANG4" => Some(0x97),
        "LANG5" => Some(0x98),
        "HELP" => Some(0x2F),
        "SELECT" => Some(0x29),
        "CLEAR" => Some(0x0C),
        "EXECUTE" => Some(0x2B),
        "SLEEP" => Some(0x5F),
        "POWER" => Some(0x5E),
        "WAKEUP" => Some(0x5F),
        _ => None,
    }
}

#[cfg(not(windows))]
pub fn register(_app: &AppHandle, _actions: Vec<String>) {}

#[cfg(not(windows))]
pub fn failures() -> Vec<String> {
    Vec::new()
}
