//! 动态壁纸的桌面层窗口：桌面类型、点击穿透、跨工作区与首帧前透明。

use std::time::Duration;

use tauri::window::WindowBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Window};
use x11rb::connection::Connection;
use x11rb::protocol::shape::{ConnectionExt as _, SK, SO};
use x11rb::protocol::xproto::{
    AtomEnum, ClientMessageEvent, ClipOrdering, ConnectionExt as _, EventMask, PropMode,
    Window as XWindow,
};
use x11rb::wrapper::ConnectionExt as _;

use super::{Bounds, X11_REQUIRED};

const TITLE: &str = "CraftSharp 壁纸";
/// 首帧就绪前窗口先映射在屏幕外，画好画面再移进桌面
const HIDDEN: f64 = -32000.0;

/// 建好窗口后先在屏幕外映射，渲染线程画好首帧再移进桌面
pub(super) fn create(
    app: &AppHandle,
    label: &str,
    bounds: Bounds,
    scale: f64,
) -> Result<(Window, u32), String> {
    let window = WindowBuilder::new(app, label)
        .title(TITLE)
        .position(HIDDEN, HIDDEN)
        .inner_size(
            bounds.width() as f64 / scale,
            bounds.height() as f64 / scale,
        )
        .decorations(false)
        .shadow(false)
        // Linux 的非可调整窗口会被 GTK 撑到默认高度，必须允许程序改尺寸
        .resizable(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible_on_all_workspaces(true)
        .visible(false)
        .build()
        .map_err(|error| format!("创建壁纸窗口失败：{error}"))?;
    if let Err(error) = prepare(&window) {
        let _ = window.close();
        return Err(error);
    }
    let xid = match show(&window) {
        Ok(xid) => xid,
        Err(error) => {
            let _ = window.close();
            return Err(error);
        }
    };
    Ok((window, xid))
}

pub(super) fn place(window: &Window, bounds: Bounds, scale: f64) -> Result<(), String> {
    window
        .set_position(LogicalPosition::new(
            bounds.left as f64 / scale,
            bounds.top as f64 / scale,
        ))
        .map_err(|error| format!("移动壁纸窗口失败：{error}"))?;
    window
        .set_size(LogicalSize::new(
            bounds.width() as f64 / scale,
            bounds.height() as f64 / scale,
        ))
        .map_err(|error| format!("调整壁纸窗口失败：{error}"))
}

/// 映射前声明桌面层窗口；标题栏、任务栏与点击穿透交给 GTK
fn prepare(window: &Window) -> Result<(), String> {
    use gtk::gdk;
    use gtk::prelude::*;

    let gtk_window = window
        .gtk_window()
        .map_err(|_| X11_REQUIRED.to_string())?;
    gtk_window.set_type_hint(gdk::WindowTypeHint::Desktop);
    gtk_window.set_skip_taskbar_hint(true);
    gtk_window.set_skip_pager_hint(true);
    gtk_window.set_focus_on_map(false);
    gtk_window.set_accept_focus(false);
    // 窗口自身不画任何底色，内容只来自 GStreamer 提交的视频帧
    gtk_window.set_app_paintable(true);
    let empty = gtk::cairo::Region::create();
    gtk_window.input_shape_combine_region(Some(&empty));
    gtk_window.realize();
    set_opacity(xid_of(&gtk_window)?, 0)
}

/// 先按屏幕外位置映射，画面就绪后再由渲染线程移进桌面
pub(super) fn show(window: &Window) -> Result<u32, String> {
    use gtk::prelude::*;

    let gtk_window = window
        .gtk_window()
        .map_err(|_| X11_REQUIRED.to_string())?;
    gtk_window.show();
    gtk_window.stick();
    let empty = gtk::cairo::Region::create();
    gtk_window.input_shape_combine_region(Some(&empty));
    let xid = xid_of(&gtk_window)?;
    set_opacity(xid, 0)?;
    spawn_restack(xid);
    Ok(xid)
}

fn xid_of(gtk_window: &gtk::ApplicationWindow) -> Result<u32, String> {
    use gtk::glib::Cast;
    use gtk::prelude::*;

    let gdk_window = gtk_window
        .window()
        .ok_or_else(|| X11_REQUIRED.to_string())?;
    let x11_window = gdk_window
        .downcast::<gdkx11::X11Window>()
        .map_err(|_| X11_REQUIRED.to_string())?;
    Ok(x11_window.xid() as u32)
}

/// GStreamer 接管窗口后 GTK 的输入区可能被重置，这里直接清空 XShape 输入区
pub(super) fn set_click_through(xid: u32) -> Result<(), String> {
    let (conn, _) = x11rb::connect(None).map_err(|_| X11_REQUIRED.to_string())?;
    clear_input(&conn, xid)
}

/// 看门狗复用已有连接，避免每秒新建 X 连接
pub(super) fn clear_input(
    conn: &x11rb::rust_connection::RustConnection,
    xid: u32,
) -> Result<(), String> {
    conn.shape_rectangles(SO::SET, SK::INPUT, ClipOrdering::UNSORTED, xid, 0, 0, &[])
        .map_err(|error| error.to_string())?;
    conn.flush().map_err(|error| error.to_string())
}

/// 部分合成器不会对桌面层窗口应用透明度，这里只作为首帧前的额外保险
pub(super) fn set_opacity(xid: u32, value: u32) -> Result<(), String> {
    let (conn, _) = x11rb::connect(None).map_err(|_| X11_REQUIRED.to_string())?;
    let atom = intern(&conn, "_NET_WM_WINDOW_OPACITY").ok_or_else(|| X11_REQUIRED.to_string())?;
    conn.change_property32(PropMode::REPLACE, xid, atom, AtomEnum::CARDINAL, &[value])
        .map_err(|error| error.to_string())?
        .check()
        .map_err(|error| error.to_string())?;
    conn.flush().map_err(|error| error.to_string())
}

/// 映射瞬间的请求可能被 mutter 的入栈覆盖，等窗口进入栈后补发几次
fn spawn_restack(xid: u32) {
    let _ = std::thread::Builder::new()
        .name("wallpaper-restack".into())
        .spawn(move || {
            let Ok((conn, screen)) = x11rb::connect(None) else {
                return;
            };
            let root = conn.setup().roots[screen].root;
            for _ in 0..40 {
                if read_stack(&conn, root).is_some_and(|stack| stack.contains(&xid)) {
                    for _ in 0..4 {
                        lower(&conn, root, &[xid]);
                        std::thread::sleep(Duration::from_millis(150));
                    }
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        });
}

/// 用分页器身份的 EWMH 请求沉底；普通 ConfigureRequest 会被 mutter 丢弃。
/// data 依次是 source indication、sibling window、detail，sibling 0 表示没有邻窗
pub(super) fn lower(conn: &x11rb::rust_connection::RustConnection, root: XWindow, xids: &[u32]) {
    let Some(atom) = intern(conn, "_NET_RESTACK_WINDOW") else {
        return;
    };
    for xid in xids {
        let event = ClientMessageEvent::new(32, *xid, atom, [2, 0, 1, 0, 0]);
        let _ = conn.send_event(
            false,
            root,
            EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
            event,
        );
    }
    let _ = conn.flush();
}

pub(super) fn read_stack(
    conn: &x11rb::rust_connection::RustConnection,
    root: XWindow,
) -> Option<Vec<u32>> {
    let atom = intern(conn, "_NET_CLIENT_LIST_STACKING")?;
    let reply = conn
        .get_property(false, root, atom, AtomEnum::WINDOW, 0, 4096)
        .ok()?
        .reply()
        .ok()?;
    reply.value32().map(|values| values.collect())
}

fn intern(conn: &x11rb::rust_connection::RustConnection, name: &str) -> Option<u32> {
    conn.intern_atom(false, name.as_bytes())
        .ok()?
        .reply()
        .ok()
        .map(|reply| reply.atom)
}