//! Wayland 全局键盘监听：直接读取 /dev/input 事件，不依赖合成器焦点。
//! 依赖安装包附带的 70-craftsharp-input.rules 给输入设备授予 uaccess。

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{ConnectionExt, Window};
use x11rb::rust_connection::RustConnection;

use crate::hotkeys::{apply_hotkeys, on_hook_down, on_hook_up};
use crate::keys_x11::key_map;

const RELEASE_GRACE: Duration = Duration::from_millis(40);
const EXPIRE_POLL: Duration = Duration::from_millis(4);
const SCAN_INTERVAL: Duration = Duration::from_secs(2);
const EVENT_SIZE: usize = 24;
/// 键盘至少具备一个字母键；鼠标与手写笔只有 BTN_* 位
const LETTER_KEYS: [usize; 4] = [16, 18, 30, 57];

static STARTED: OnceLock<()> = OnceLock::new();
static READY: AtomicBool = AtomicBool::new(false);
static WARNED: AtomicBool = AtomicBool::new(false);

/// 启动监听，返回当前是否已就绪；未就绪时由监听线程补发首次绑定。
pub fn start(app: &AppHandle) -> bool {
    STARTED.get_or_init(|| {
        let app = app.clone();
        thread::spawn(move || run(app));
    });
    READY.load(Ordering::SeqCst)
}

pub fn ready() -> bool {
    READY.load(Ordering::SeqCst)
}

struct Hub {
    conn: RustConnection,
    root: Window,
    active_atom: u32,
    class_atom: u32,
    pid_atom: u32,
    keys: HashMap<u8, u32>,
    down: Vec<u16>,
    /// 松开先进入缓冲，短时间内同一键再次出现视为系统自动重复
    pending: Vec<(u16, u32, Instant)>,
    skip: bool,
    open: HashSet<PathBuf>,
}

impl Hub {
    fn press(&mut self, code: u16) {
        let Some(vk) = self.vk(code) else { return };
        if self.down.contains(&code) {
            self.pending.retain(|(key, _, _)| *key != code);
            return;
        }
        if self.down.is_empty() {
            self.skip = crate::hotkeys_x11::settings_focused(
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

    fn release(&mut self, code: u16) {
        if !self.down.contains(&code) {
            return;
        }
        let Some(vk) = self.vk(code) else { return };
        self.pending.retain(|(key, _, _)| *key != code);
        self.pending.push((code, vk, Instant::now() + RELEASE_GRACE));
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

    /// evdev 键码对应 X 键码加 8，借 XWayland 的键盘映射还原虚拟键码
    fn vk(&self, code: u16) -> Option<u32> {
        let xcode = u8::try_from(code.checked_add(8)?).ok()?;
        self.keys.get(&xcode).copied()
    }
}

fn run(app: AppHandle) {
    let Ok((conn, screen)) = x11rb::connect(None) else {
        eprintln!("Wayland 全局快捷键需要 XWayland 连接");
        return;
    };
    let root = conn.setup().roots[screen].root;
    let Some(active_atom) = intern(&conn, "_NET_ACTIVE_WINDOW") else { return };
    let Some(class_atom) = intern(&conn, "WM_CLASS") else { return };
    let Some(pid_atom) = intern(&conn, "_NET_WM_PID") else { return };
    let keys = key_map(&conn);

    let hub = Arc::new(Mutex::new(Hub {
        conn,
        root,
        active_atom,
        class_atom,
        pid_atom,
        keys,
        down: Vec::new(),
        pending: Vec::new(),
        skip: false,
        open: HashSet::new(),
    }));

    scan(&hub, &app);

    let ticker = hub.clone();
    thread::spawn(move || loop {
        thread::sleep(EXPIRE_POLL);
        if let Ok(mut hub) = ticker.lock() {
            hub.expire();
        }
    });

    thread::spawn(move || loop {
        thread::sleep(SCAN_INTERVAL);
        scan(&hub, &app);
    });
}

/// 定期扫描输入设备，新插入的键盘或后补的权限都不必重启应用。
fn scan(hub: &Arc<Mutex<Hub>>, app: &AppHandle) {
    let Ok(entries) = fs::read_dir("/dev/input") else { return };
    let paths: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("event"))
                .unwrap_or(false)
        })
        .collect();

    for path in paths {
        if hub.lock().map(|hub| hub.open.contains(&path)).unwrap_or(true) {
            continue;
        }
        if !is_keyboard(&path) {
            continue;
        }
        let Ok(file) = File::open(&path) else { continue };
        if let Ok(mut hub) = hub.lock() {
            hub.open.insert(path.clone());
        }
        let reader = hub.clone();
        let reader_path = path.clone();
        thread::spawn(move || read_device(file, reader_path, reader));
    }

    let listening = hub.lock().map(|hub| !hub.open.is_empty()).unwrap_or(false);
    if listening && !READY.swap(true, Ordering::SeqCst) {
        apply_hotkeys(app);
    }
    if !listening && !WARNED.swap(true, Ordering::SeqCst) {
        eprintln!("Wayland 全局快捷键需要读取输入设备，请安装 70-craftsharp-input.rules");
    }
}

fn read_device(mut file: File, path: PathBuf, hub: Arc<Mutex<Hub>>) {
    let mut buffer = [0u8; EVENT_SIZE * 32];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => {
                let Ok(mut hub) = hub.lock() else { break };
                let mut offset = 0;
                while offset + EVENT_SIZE <= size {
                    let kind = u16::from_ne_bytes([buffer[offset + 16], buffer[offset + 17]]);
                    let code = u16::from_ne_bytes([buffer[offset + 18], buffer[offset + 19]]);
                    let value = i32::from_ne_bytes([
                        buffer[offset + 20],
                        buffer[offset + 21],
                        buffer[offset + 22],
                        buffer[offset + 23],
                    ]);
                    offset += EVENT_SIZE;
                    // EV_KEY
                    if kind != 1 {
                        continue;
                    }
                    match value {
                        0 => hub.release(code),
                        1 | 2 => hub.press(code),
                        _ => {}
                    }
                }
                hub.expire();
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    if let Ok(mut hub) = hub.lock() {
        hub.open.remove(&path);
    }
}

/// 键位能力表按 64 位分组、高位在前；含字母键才当作键盘读取。
fn is_keyboard(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else { return false };
    let Ok(text) = fs::read_to_string(format!("/sys/class/input/{name}/device/capabilities/key"))
    else {
        return true;
    };
    let words: Vec<u64> = text
        .split_whitespace()
        .rev()
        .map(|word| u64::from_str_radix(word, 16).unwrap_or(0))
        .collect();
    LETTER_KEYS.iter().any(|key| {
        words
            .get(key / 64)
            .map(|word| word & (1u64 << (key % 64)) != 0)
            .unwrap_or(false)
    })
}

fn intern(conn: &RustConnection, name: &str) -> Option<u32> {
    conn.intern_atom(false, name.as_bytes())
        .ok()?
        .reply()
        .ok()
        .map(|reply| reply.atom)
}
