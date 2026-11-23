//! X11 全局键盘监听：XI2 原始按键事件驱动与 Windows 相同的序列状态机。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use x11rb::connection::Connection;
use x11rb::protocol::xinput::{ConnectionExt as XinputExt, EventMask, XIEventMask};
use x11rb::protocol::xkb::{BoolCtrl, ConnectionExt as XkbExt, PerClientFlag};
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as XprotoExt, Window};
use x11rb::protocol::Event as XEvent;
use x11rb::rust_connection::RustConnection;

use crate::hotkeys::{apply_hotkeys, on_hook_down, on_hook_up};
use crate::keys_x11::key_map;

static STARTED: OnceLock<()> = OnceLock::new();
static READY: AtomicBool = AtomicBool::new(false);

/// 物理松开后留出自动重复的判定窗口
const RELEASE_GRACE: Duration = Duration::from_millis(40);
const GRACE_POLL: Duration = Duration::from_millis(2);

pub fn ready() -> bool {
    READY.load(Ordering::SeqCst)
}

/// 启动全局监听，返回监听是否已经就绪；未就绪时由监听线程补做首次绑定。
pub fn start(app: &AppHandle) -> bool {
    STARTED.get_or_init(|| {
        let app = app.clone();
        thread::spawn(move || run(app));
    });
    READY.load(Ordering::SeqCst)
}

fn run(app: AppHandle) {
    let Ok((conn, screen)) = x11rb::connect(None) else {
        eprintln!("全局快捷键监听连接失败");
        return;
    };
    let root = conn.setup().roots[screen].root;
    if conn
        .xinput_xi_query_version(2, 2)
        .ok()
        .and_then(|cookie| cookie.reply().ok())
        .is_none()
    {
        eprintln!("全局快捷键监听需要 XInput2");
        return;
    }
    // 本连接不产生自动重复的松开/再按下对，物理按下始终保持按住
    let _ = conn.xkb_per_client_flags(
        0x0100,
        PerClientFlag::DETECTABLE_AUTO_REPEAT,
        PerClientFlag::DETECTABLE_AUTO_REPEAT,
        BoolCtrl::default(),
        BoolCtrl::default(),
        BoolCtrl::default(),
    );

    let masks = [EventMask {
        deviceid: 0,
        mask: vec![XIEventMask::RAW_KEY_PRESS | XIEventMask::RAW_KEY_RELEASE],
    }];
    match conn.xinput_xi_select_events(root, &masks) {
        Ok(cookie) => {
            if let Err(error) = cookie.check() {
                eprintln!("全局快捷键监听启动失败: {error:?}");
                return;
            }
        }
        Err(error) => {
            eprintln!("全局快捷键监听启动失败: {error:?}");
            return;
        }
    }

    let Some(active_atom) = intern(&conn, "_NET_ACTIVE_WINDOW") else {
        return;
    };
    let Some(class_atom) = intern(&conn, "WM_CLASS") else {
        return;
    };
    let Some(pid_atom) = intern(&conn, "_NET_WM_PID") else {
        return;
    };
    let keys = key_map(&conn);
    let mut watch = Watch {
        conn,
        root,
        active_atom,
        class_atom,
        pid_atom,
        keys,
        down: Vec::new(),
        pending: Vec::new(),
        skip: false,
    };
    let _ = watch.conn.flush();

    READY.store(true, Ordering::SeqCst);
    apply_hotkeys(&app);

    loop {
        if watch.pending.is_empty() {
            match watch.conn.wait_for_event() {
                Ok(event) => watch.event(event),
                Err(_) => return,
            }
        } else {
            let mut received = false;
            match watch.conn.poll_for_event() {
                Ok(Some(event)) => {
                    watch.event(event);
                    received = true;
                }
                Ok(None) => {}
                Err(_) => return,
            }
            loop {
                match watch.conn.poll_for_event() {
                    Ok(Some(event)) => {
                        watch.event(event);
                        received = true;
                    }
                    Ok(None) => break,
                    Err(_) => return,
                }
            }
            if !received {
                thread::sleep(GRACE_POLL);
            }
        }
        watch.expire();
    }
}

struct Watch {
    conn: RustConnection,
    root: Window,
    active_atom: u32,
    class_atom: u32,
    pid_atom: u32,
    keys: HashMap<u8, u32>,
    down: Vec<u8>,
    /// 松开先进入缓冲，短时间内同一键再次按下视为系统自动重复
    pending: Vec<(u8, u32, Instant)>,
    skip: bool,
}

impl Watch {
    fn event(&mut self, event: XEvent) {
        match event {
            XEvent::XinputRawKeyPress(event) => {
                let code = event.detail as u8;
                let Some(&vk) = self.keys.get(&code) else {
                    return;
                };
                if self.down.contains(&code) {
                    self.pending.retain(|(key, _, _)| *key != code);
                    return;
                }
                if self.down.is_empty() {
                    self.skip = settings_focused(
                        &self.conn,
                        self.root,
                        self.active_atom,
                        self.class_atom,
                        self.pid_atom,
                    );
                }
                self.down.push(code);
                if !self.skip {
                    on_hook_down(vk);
                }
            }
            XEvent::XinputRawKeyRelease(event) => {
                let code = event.detail as u8;
                let Some(&vk) = self.keys.get(&code) else {
                    return;
                };
                if !self.down.contains(&code) {
                    return;
                }
                self.pending.retain(|(key, _, _)| *key != code);
                self.pending.push((code, vk, Instant::now() + RELEASE_GRACE));
            }
            XEvent::MappingNotify(_) => {
                self.keys = key_map(&self.conn);
            }
            _ => {}
        }
    }

    fn expire(&mut self) {
        let now = Instant::now();
        let mut released = Vec::new();
        self.pending.retain(|(code, vk, deadline)| {
            if *deadline > now {
                return true;
            }
            released.push((*code, *vk));
            false
        });
        for (code, vk) in released {
            self.down.retain(|key| *key != code);
            if !self.skip {
                on_hook_up(vk);
            }
            if self.down.is_empty() {
                self.skip = false;
            }
        }
    }
}

fn intern(conn: &RustConnection, name: &str) -> Option<u32> {
    conn.intern_atom(false, name.as_bytes())
        .ok()?
        .reply()
        .ok()
        .map(|reply| reply.atom)
}

/// 本应用的 WebView 窗口获得焦点时让路；原生 HUD 窗口自己处理局部按键
fn settings_focused(
    conn: &RustConnection,
    root: Window,
    active_atom: u32,
    class_atom: u32,
    pid_atom: u32,
) -> bool {
    let focused = conn
        .get_input_focus()
        .ok()
        .and_then(|cookie| cookie.reply().ok())
        .map(|reply| reply.focus)
        .unwrap_or(0);
    let target = if focused > 1 {
        focused
    } else {
        conn.get_property(false, root, active_atom, AtomEnum::WINDOW, 0, 1)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .and_then(|reply| reply.value32().and_then(|mut values| values.next()))
            .unwrap_or(0)
    };
    if target == 0 {
        return false;
    }
    let Some((owner, class)) = class_of(conn, target, class_atom) else {
        return false;
    };
    // 状态栏与准星窗口自己处理局部按键，全局序列继续生效
    if is_hud(&class) {
        return false;
    }
    if read_u32(conn, owner, pid_atom) == Some(std::process::id()) {
        return true;
    }
    class.contains("craftsharp-desktop")
}

fn is_hud(class: &str) -> bool {
    const HUD: [&str; 6] = [
        "craftsharphud",
        "craftsharpbossbar",
        "craftsharpcrosshair",
        "craftsharptooltip",
        "craftsharpdragicon",
        "craftsharpoverlay",
    ];
    class
        .split('\0')
        .any(|part| HUD.contains(&part))
}

/// 焦点可能落在 WebView 子窗口上，沿父链找到带 WM_CLASS 的顶层窗口
fn class_of(conn: &RustConnection, mut win: Window, class_atom: u32) -> Option<(Window, String)> {
    for _ in 0..8 {
        if win == 0 {
            break;
        }
        if let Some(reply) = conn
            .get_property(false, win, class_atom, AtomEnum::STRING, 0, 64)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
        {
            if !reply.value.is_empty() {
                let class = String::from_utf8_lossy(&reply.value).to_ascii_lowercase();
                return Some((win, class));
            }
        }
        win = conn
            .query_tree(win)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map(|reply| reply.parent)
            .unwrap_or(0);
    }
    None
}

fn read_u32(conn: &RustConnection, win: Window, atom: u32) -> Option<u32> {
    conn.get_property(false, win, atom, AtomEnum::CARDINAL, 0, 1)
        .ok()?
        .reply()
        .ok()?
        .value32()
        .and_then(|mut values| values.next())
}
