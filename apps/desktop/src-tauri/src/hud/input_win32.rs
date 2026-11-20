//! Windows 输入后端：低层键鼠钩子与前台变化通知，只归一事件并转发。

#![allow(non_snake_case)]

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

use crate::hud::input;
use crate::hud::window;
use crate::hud::win32 as w;

/// 桌面层窗口不激活、拿不到焦点，点击快捷栏后由钩子接住窗口内输入。
static KEY_HOOK: AtomicIsize = AtomicIsize::new(0);
static MOUSE_HOOK: AtomicIsize = AtomicIsize::new(0);
static FOREGROUND_HOOK: AtomicIsize = AtomicIsize::new(0);
static HOOKS_INSTALLED: AtomicBool = AtomicBool::new(false);

#[repr(C)]
#[allow(dead_code)]
struct KeyboardHookData {
    vk_code: u32,
    scan_code: u32,
    flags: u32,
    time: u32,
    extra_info: usize,
}

#[repr(C)]
#[allow(dead_code)]
struct MouseHookData {
    pt: w::Point,
    mouse_data: u32,
    flags: u32,
    time: u32,
    extra_info: usize,
}

pub fn install_desktop_hooks() {
    if HOOKS_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    // SAFETY: 钩子过程在本进程内，hMod 必须为 0 才会回调
    let key_hook = unsafe { w::SetWindowsHookExW(w::WH_KEYBOARD_LL, Some(keyboard_hook), 0, 0) };
    if key_hook != 0 {
        KEY_HOOK.store(key_hook, Ordering::SeqCst);
    }
    let mouse_hook = unsafe { w::SetWindowsHookExW(w::WH_MOUSE_LL, Some(mouse_hook), 0, 0) };
    if mouse_hook != 0 {
        MOUSE_HOOK.store(mouse_hook, Ordering::SeqCst);
    }
    // SAFETY: 前台变化事件用于收回快捷栏的键盘焦点
    let foreground_hook = unsafe {
        w::SetWinEventHook(
            w::EVENT_SYSTEM_FOREGROUND,
            w::EVENT_SYSTEM_FOREGROUND,
            0,
            Some(foreground_event),
            0,
            0,
            w::WINEVENT_OUTOFCONTEXT | w::WINEVENT_SKIPOWNPROCESS,
        )
    };
    if foreground_hook != 0 {
        FOREGROUND_HOOK.store(foreground_hook, Ordering::SeqCst);
    }
    if key_hook == 0 || mouse_hook == 0 {
        eprintln!("桌面输入钩子安装失败");
    }
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: usize, lparam: isize) -> isize {
    // 只在点击快捷栏取得键盘焦点后接管，其他情况一律放过
    if code >= 0 && input::hotbar_active() {
        let data = &*(lparam as *const KeyboardHookData);
        let extended = data.flags & crate::hotkeys::LLKHF_EXTENDED != 0;
        let vk = crate::hotkeys::normalized_key(data.vk_code, data.scan_code, extended);
        match wparam as u32 {
            w::WM_KEYUP | w::WM_SYSKEYUP => input::on_key_up(vk),
            w::WM_KEYDOWN | w::WM_SYSKEYDOWN => {
                let handled =
                    window::with_state(|state| input::global_key(state, vk)).unwrap_or(false);
                if handled {
                    return 1;
                }
            }
            _ => {}
        }
    }
    w::CallNextHookEx(KEY_HOOK.load(Ordering::Relaxed), code, wparam, lparam)
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: usize, lparam: isize) -> isize {
    if code >= 0 {
        let data = &*(lparam as *const MouseHookData);
        if wparam == w::WM_LBUTTONDOWN as usize {
            // 点击快捷栏取得键盘焦点，点击别处失去
            let on_hotbar =
                window::with_state(|state| input::hit_hotbar(state, data.pt.x, data.pt.y))
                    .unwrap_or(false);
            input::set_hotbar_active(on_hotbar);
        } else if wparam == w::WM_MOUSEWHEEL as usize {
            let delta = ((data.mouse_data >> 16) & 0xffff) as i16;
            let handled = window::with_state(|state| {
                input::wheel_at(state, data.pt.x, data.pt.y, delta)
            })
            .unwrap_or(false);
            if handled {
                return 1;
            }
        }
    }
    w::CallNextHookEx(MOUSE_HOOK.load(Ordering::Relaxed), code, wparam, lparam)
}

unsafe extern "system" fn foreground_event(
    _hook: isize,
    _event: u32,
    _hwnd: isize,
    _object: i32,
    _child: i32,
    _thread: u32,
    _time: u32,
) {
    // 前台切到别的窗口，快捷栏不再持有键盘焦点
    input::focus_lost();
    // 显示桌面恢复后窗口可能停在应用之上，前台回到外部窗口时重新置底归位
    window::repark_desktop_windows();
}
