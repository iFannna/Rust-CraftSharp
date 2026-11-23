//! X11 窗口提升：普通窗口显示后显式抬升并取得焦点，避免停在其他窗口之下。

use std::time::Duration;

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    AtomEnum, ConfigureWindowAux, ConnectionExt, InputFocus, StackMode, Window,
};
use x11rb::rust_connection::RustConnection;

pub fn raise(window: &tauri::WebviewWindow) {
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(60));
        // 先借窗口管理器的置顶状态强制重排，再恢复普通层级
        let _ = window.set_always_on_top(true);
        let title = window.title().unwrap_or_default();
        if let Ok((conn, screen)) = x11rb::connect(None) {
            let root = conn.setup().roots[screen].root;
            if let Some(target) = find(&conn, root, &title, 4) {
                let above = ConfigureWindowAux::new().stack_mode(StackMode::ABOVE);
                let _ = conn.configure_window(target, &above);
                let _ = conn.set_input_focus(InputFocus::PARENT, target, 0u32);
                let _ = conn.flush();
            }
        }
        std::thread::sleep(Duration::from_millis(30));
        let _ = window.set_always_on_top(false);
    });
}

fn find(conn: &RustConnection, win: Window, title: &str, depth: u32) -> Option<Window> {
    if is_target(conn, win, title) {
        return Some(win);
    }
    if depth == 0 {
        return None;
    }
    let children = conn.query_tree(win).ok()?.reply().ok()?.children;
    for child in children {
        if let Some(found) = find(conn, child, title, depth - 1) {
            return Some(found);
        }
    }
    None
}

fn is_target(conn: &RustConnection, win: Window, title: &str) -> bool {
    let pid = conn
        .intern_atom(false, b"_NET_WM_PID")
        .ok()
        .and_then(|cookie| cookie.reply().ok())
        .and_then(|reply| read_u32(conn, win, reply.atom));
    let ours = pid == Some(std::process::id());
    if !ours {
        let class = read(conn, win, AtomEnum::WM_CLASS.into(), AtomEnum::STRING.into());
        if !class
            .map(|text| text.to_ascii_lowercase().contains("craftsharp"))
            .unwrap_or(false)
        {
            return false;
        }
    }
    if title.is_empty() {
        return true;
    }
    let net_name = conn
        .intern_atom(false, b"_NET_WM_NAME")
        .ok()
        .and_then(|cookie| cookie.reply().ok())
        .map(|reply| reply.atom);
    let name = net_name
        .and_then(|atom| read(conn, win, atom, 0))
        .or_else(|| read(conn, win, AtomEnum::WM_NAME.into(), AtomEnum::STRING.into()));
    name.map(|text| text.trim_end_matches('\0').trim() == title.trim())
        .unwrap_or(false)
}

fn read_u32(conn: &RustConnection, win: Window, atom: u32) -> Option<u32> {
    conn.get_property(false, win, atom, AtomEnum::CARDINAL, 0, 1)
        .ok()?
        .reply()
        .ok()?
        .value32()
        .and_then(|mut values| values.next())
}

fn read(conn: &RustConnection, win: Window, atom: u32, kind: u32) -> Option<String> {
    let reply = conn
        .get_property(false, win, atom, kind, 0, 128)
        .ok()?
        .reply()
        .ok()?;
    if reply.value.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&reply.value).into_owned())
}
