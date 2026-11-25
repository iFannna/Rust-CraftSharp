//! X11 文件拖放：XDND 目标端与拖出源端。
//! 自有窗口之间的拖放直接在本地完成，外部目标才走完整 XDND 协议。

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::AppHandle;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    AtomEnum, ClientMessageEvent, ConnectionExt, CreateWindowAux, EventMask, KeyButMask, PropMode,
    SelectionNotifyEvent, SelectionRequestEvent, Window, WindowClass, SELECTION_NOTIFY_EVENT,
};
use x11rb::protocol::Event as XEvent;
use x11rb::rust_connection::RustConnection;

use crate::hud::sprite::{self, Sprite};

const VERSION: u32 = 5;
const DATA_PROP: &str = "CRAFTSHARP_DRAG_DATA";
const TIME_PROP: &str = "CRAFTSHARP_DRAG_TIME";
const DRAG_OWNER: &str = "dragdrop";

/// 拖放接受区域，坐标为窗口客户区物理像素。
#[derive(Clone, Deserialize)]
pub struct Zone {
    pub id: String,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

impl Zone {
    fn hit(&self, x: f64, y: f64) -> bool {
        x >= self.left && x <= self.left + self.width && y >= self.top && y <= self.top + self.height
    }
}

/// 拖放结果，语义与 Windows 端一致。
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragResult {
    pub dropped: bool,
    pub window: Option<String>,
    pub zone: Option<String>,
    pub same_source: bool,
    pub handled: bool,
}

type HoverHandler = Arc<dyn Fn(&str, Option<&str>) + Send + Sync>;

fn hover_handler() -> &'static Mutex<Option<HoverHandler>> {
    static HANDLER: OnceLock<Mutex<Option<HoverHandler>>> = OnceLock::new();
    HANDLER.get_or_init(|| Mutex::new(None))
}

pub fn set_hover_handler(handler: impl Fn(&str, Option<&str>) + Send + Sync + 'static) {
    *hover_handler().lock().unwrap_or_else(|error| error.into_inner()) = Some(Arc::new(handler));
}

/// 悬停回调必须在主线程执行，窗口状态是 thread_local。
fn report_hover(label: &str, zone: Option<&str>) {
    let handler = hover_handler().lock().unwrap_or_else(|error| error.into_inner()).clone();
    if let Some(handler) = handler {
        handler(label, zone);
    }
}

fn drag_source() -> &'static Mutex<Option<(String, String)>> {
    static SOURCE: OnceLock<Mutex<Option<(String, String)>>> = OnceLock::new();
    SOURCE.get_or_init(|| Mutex::new(None))
}

fn last_drop() -> &'static Mutex<Option<(String, String, bool, bool)>> {
    static DROP: OnceLock<Mutex<Option<(String, String, bool, bool)>>> = OnceLock::new();
    DROP.get_or_init(|| Mutex::new(None))
}

fn drag_source_pair() -> Option<(String, String)> {
    drag_source().lock().unwrap_or_else(|error| error.into_inner()).clone()
}

fn is_drag_source(label: &str, zone: &str) -> bool {
    let source = drag_source().lock().unwrap_or_else(|error| error.into_inner());
    matches!(source.as_ref(), Some((source_label, source_zone)) if source_label == label && source_zone == zone)
}

/// 接受区域按窗口标签共享，注册与下发共用同一份。
fn zones() -> &'static Mutex<HashMap<String, Arc<Mutex<Vec<Zone>>>>> {
    static ZONES: OnceLock<Mutex<HashMap<String, Arc<Mutex<Vec<Zone>>>>>> = OnceLock::new();
    ZONES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn zone_slot(label: &str) -> Arc<Mutex<Vec<Zone>>> {
    let mut map = zones().lock().unwrap_or_else(|error| error.into_inner());
    map.entry(label.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(Vec::new())))
        .clone()
}

pub fn set_zones(label: &str, list: Vec<Zone>) {
    let slot = zone_slot(label);
    *slot.lock().unwrap_or_else(|error| error.into_inner()) = list;
}

/// 点击穿透的浮层不参与目标解析，避免拖拽图标挡住指针下的真实窗口。
fn helpers() -> &'static Mutex<HashSet<Window>> {
    static HELPERS: OnceLock<Mutex<HashSet<Window>>> = OnceLock::new();
    HELPERS.get_or_init(|| Mutex::new(HashSet::new()))
}

pub fn register_helper(win: Window) {
    helpers().lock().unwrap_or_else(|error| error.into_inner()).insert(win);
}

/// 已安装拖放目标的本应用窗口，标签用于查接受区域与悬停反馈。
fn targets() -> &'static Mutex<HashMap<Window, String>> {
    static TARGETS: OnceLock<Mutex<HashMap<Window, String>>> = OnceLock::new();
    TARGETS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn local_label(win: Window) -> Option<String> {
    targets().lock().unwrap_or_else(|error| error.into_inner()).get(&win).cloned()
}

#[derive(Clone, Copy)]
struct Atoms {
    aware: u32,
    enter: u32,
    position: u32,
    status: u32,
    leave: u32,
    drop: u32,
    finished: u32,
    selection: u32,
    type_list: u32,
    uri_list: u32,
    copy: u32,
    targets: u32,
    data: u32,
    time: u32,
}

fn atoms(conn: &RustConnection) -> Option<&'static Atoms> {
    static ATOMS: OnceLock<Option<Atoms>> = OnceLock::new();
    ATOMS
        .get_or_init(|| {
            let intern = |name: &str| conn.intern_atom(false, name.as_bytes()).ok()?.reply().ok().map(|r| r.atom);
            Some(Atoms {
                aware: intern("XdndAware")?,
                enter: intern("XdndEnter")?,
                position: intern("XdndPosition")?,
                status: intern("XdndStatus")?,
                leave: intern("XdndLeave")?,
                drop: intern("XdndDrop")?,
                finished: intern("XdndFinished")?,
                selection: intern("XdndSelection")?,
                type_list: intern("XdndTypeList")?,
                uri_list: intern("text/uri-list")?,
                copy: intern("XdndActionCopy")?,
                targets: intern("TARGETS")?,
                data: intern(DATA_PROP)?,
                time: intern(TIME_PROP)?,
            })
        })
        .as_ref()
}

/* ----------------------------- 目标端 ----------------------------- */

struct TargetState {
    types_ok: bool,
    hovered: Option<String>,
    /// 落点区域与源窗口，等选区数据返回后一次写入。
    pending: Option<(String, Window)>,
    stamp: u32,
}

pub fn install(app: &AppHandle, label: &str, win: Window, conn: Arc<RustConnection>, root: Window) {
    let Some(atoms) = atoms(&conn) else { return };
    let _ = conn.change_property(
        PropMode::REPLACE,
        win,
        atoms.aware,
        AtomEnum::ATOM,
        32,
        1,
        &VERSION.to_ne_bytes(),
    );
    let _ = conn.flush();
    targets()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(win, label.to_string());

    let app = app.clone();
    let label = label.to_string();
    std::thread::spawn(move || {
        let mut state = TargetState { types_ok: false, hovered: None, pending: None, stamp: 0 };
        loop {
            let mut busy = false;
            loop {
                match conn.poll_for_event() {
                    Ok(Some(XEvent::ClientMessage(event))) if event.window == win => {
                        busy = true;
                        handle_message(&app, &label, win, root, &conn, atoms, &mut state, event);
                    }
                    Ok(Some(XEvent::SelectionNotify(event))) if event.requestor == win => {
                        busy = true;
                        handle_notify(&app, &label, win, &conn, atoms, &mut state, event);
                    }
                    Ok(Some(_)) => busy = true,
                    Ok(None) => break,
                    Err(_) => return,
                }
            }
            std::thread::sleep(Duration::from_millis(if busy { 2 } else { 12 }));
        }
    });
}

fn handle_message(
    app: &AppHandle,
    label: &str,
    win: Window,
    root: Window,
    conn: &RustConnection,
    atoms: &Atoms,
    state: &mut TargetState,
    event: ClientMessageEvent,
) {
    let data = event.data.as_data32();
    if event.type_ == atoms.enter {
        state.types_ok = accepts_uri(conn, atoms, data[0], &data);
        state.stamp = 0;
    } else if event.type_ == atoms.position {
        let x = (data[2] >> 16) as u16 as i16 as i32;
        let y = (data[2] & 0xFFFF) as u16 as i16 as i32;
        state.stamp = data[3];
        let zone = hit_zone(label, win, root, conn, x, y);
        if state.hovered != zone {
            set_hover(app, label, &mut state.hovered, zone.clone());
        }
        send_status(conn, atoms, win, root, data[0], state.types_ok && zone.is_some());
    } else if event.type_ == atoms.leave {
        state.types_ok = false;
        state.pending = None;
        set_hover(app, label, &mut state.hovered, None);
    } else if event.type_ == atoms.drop {
        state.types_ok = false;
        let zone = state.hovered.clone();
        set_hover(app, label, &mut state.hovered, None);
        match zone {
            Some(zone) => {
                state.pending = Some((zone, data[0]));
                let time = if data[2] != 0 { data[2] } else { state.stamp };
                let _ = conn.convert_selection(win, atoms.selection, atoms.uri_list, atoms.data, time);
                let _ = conn.flush();
            }
            None => send_finished(conn, atoms, win, data[0], false),
        }
    }
}

/// 指针位置换成客户区坐标后查区域。
fn hit_zone(label: &str, win: Window, root: Window, conn: &RustConnection, x: i32, y: i32) -> Option<String> {
    let origin = conn.translate_coordinates(root, win, x as i16, y as i16).ok()?.reply().ok()?;
    let point = (origin.dst_x as f64, origin.dst_y as f64);
    let slot = zone_slot(label);
    let list = slot.lock().ok()?;
    list.iter().find(|zone| zone.hit(point.0, point.1)).map(|zone| zone.id.clone())
}

fn set_hover(app: &AppHandle, label: &str, hovered: &mut Option<String>, next: Option<String>) {
    if *hovered == next {
        return;
    }
    *hovered = next.clone();
    let label = label.to_string();
    let _ = app.run_on_main_thread(move || report_hover(&label, next.as_deref()));
}

fn send_status(conn: &RustConnection, atoms: &Atoms, win: Window, root: Window, source: Window, accept: bool) {
    let (x, y, width, height) = window_rect(conn, win, root).unwrap_or((0, 0, 1, 1));
    let flags = if accept { 1u32 | 2 } else { 2 };
    let data = [win, flags, pack(x, y), pack(width as i32, height as i32), atoms.copy];
    send(conn, source, atoms.status, data);
}

fn send_finished(conn: &RustConnection, atoms: &Atoms, win: Window, source: Window, accepted: bool) {
    let data = [win, accepted as u32, atoms.copy, 0, 0];
    send(conn, source, atoms.finished, data);
}

fn handle_notify(
    app: &AppHandle,
    label: &str,
    win: Window,
    conn: &RustConnection,
    atoms: &Atoms,
    state: &mut TargetState,
    event: SelectionNotifyEvent,
) {
    if event.selection != atoms.selection {
        return;
    }
    let Some((zone, source)) = state.pending.take() else { return };
    if let Some(path) = read_uri(conn, win, event.property) {
        let label = label.to_string();
        let _ = app.run_on_main_thread(move || crate::slots::drop_paths(&label, &zone, &path));
        send_finished(conn, atoms, win, source, true);
    } else {
        send_finished(conn, atoms, win, source, false);
    }
    set_hover(app, label, &mut state.hovered, None);
}

fn read_uri(conn: &RustConnection, win: Window, property: u32) -> Option<String> {
    if property == 0 {
        return None;
    }
    let reply = conn
        .get_property(true, win, property, AtomEnum::ANY, 0, 8192)
        .ok()?
        .reply()
        .ok()?;
    decode_uri(&reply.value)
}

fn window_rect(conn: &RustConnection, win: Window, root: Window) -> Option<(i32, i32, u32, u32)> {
    let origin = conn.translate_coordinates(win, root, 0, 0).ok()?.reply().ok()?;
    let geometry = conn.get_geometry(win).ok()?.reply().ok()?;
    Some((origin.dst_x as i32, origin.dst_y as i32, geometry.width as u32, geometry.height as u32))
}

/// 源窗口是否提供 URI 列表；类型超过三个时读 XdndTypeList。
fn accepts_uri(conn: &RustConnection, atoms: &Atoms, source: Window, data: &[u32; 5]) -> bool {
    if data[1] & 1 != 0 {
        let list = conn
            .get_property(false, source, atoms.type_list, AtomEnum::ATOM, 0, 256)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .and_then(|reply| reply.value32().map(|values| values.collect::<Vec<_>>()))
            .unwrap_or_default();
        if list.contains(&atoms.uri_list) {
            return true;
        }
    }
    data[2..5].contains(&atoms.uri_list)
}

/* ----------------------------- 源端 ----------------------------- */

/// 把格子文件拖出窗口，只复制文件，原路径不动；阻塞到松手或落点确认。
pub fn begin_file_drag(path: String, size: u32, source: Option<(String, String)>) -> DragResult {
    *drag_source().lock().unwrap_or_else(|error| error.into_inner()) = source;
    *last_drop().lock().unwrap_or_else(|error| error.into_inner()) = None;

    let dropped = drag(&path, size.clamp(1, 128));
    let report = last_drop().lock().unwrap_or_else(|error| error.into_inner()).take();
    *drag_source().lock().unwrap_or_else(|error| error.into_inner()) = None;

    match report {
        Some((window, zone, same_source, handled)) => DragResult {
            dropped,
            window: Some(window),
            zone: Some(zone),
            same_source,
            handled,
        },
        None => DragResult { dropped, window: None, zone: None, same_source: false, handled: false },
    }
}

struct External {
    win: Window,
    version: u32,
    accepted: bool,
}

fn drag(path: &str, size: u32) -> bool {
    let Ok((conn, screen)) = x11rb::connect(None) else { return false };
    let root = conn.setup().roots[screen].root;
    let Some(atoms) = atoms(&conn) else { return false };
    let Some(pointer) = query(&conn, root) else { return false };
    if !pressed(pointer.mask) {
        return false;
    }

    let Ok(win) = conn.generate_id() else { return false };
    let aux = CreateWindowAux::new().event_mask(EventMask::PROPERTY_CHANGE);
    let created = conn
        .create_window(0, win, root, 0, 0, 1, 1, 0, WindowClass::INPUT_OUTPUT, 0, &aux)
        .ok()
        .and_then(|cookie| cookie.check().ok());
    if created.is_none() {
        return false;
    }
    let _ = conn.flush();

    let mut stamp = fresh_time(&conn, win, atoms);
    let _ = conn.set_selection_owner(win, atoms.selection, stamp);
    let _ = conn.flush();

    let mut uri = encode_uri(path);
    uri.push_str("\r\n");
    let uri = uri.into_bytes();
    let sprite = crate::icons::decoded(path, false, size)
        .map(|decoded| sprite::from_rgba(decoded.size, decoded.size, &decoded.pixels));

    if let Some(sprite) = &sprite {
        show_icon(sprite, pointer.root_x as i32, pointer.root_y as i32);
    }

    let mut current: Option<External> = None;
    let mut hover: Option<(String, String)> = None;
    let mut icon_at = (pointer.root_x as i32, pointer.root_y as i32);
    let mut sent_at = Instant::now() - Duration::from_millis(100);
    let mut sent_position = (i32::MIN, i32::MIN);
    let mut stamp_at = Instant::now();
    let mut dropped = false;

    loop {
        drain(&conn, win, atoms, &uri, &mut stamp, &mut current);
        if stamp_at.elapsed() >= Duration::from_millis(200) {
            bump_time(&conn, win, atoms);
            stamp_at = Instant::now();
        }

        let Some(pointer) = query(&conn, root) else { break };
        let (x, y) = (pointer.root_x as i32, pointer.root_y as i32);
        if (x, y) != icon_at {
            icon_at = (x, y);
            if let Some(sprite) = &sprite {
                show_icon(sprite, x, y);
            }
        }

        let target = resolve(&conn, atoms, root, pointer.child);
        let local = target.and_then(local_label);
        if let Some(label) = local {
            if let Some(old) = current.take() {
                send_leave(&conn, atoms, win, old.win);
            }
            let zone = target.and_then(|target| hit_zone(&label, target, root, &conn, x, y));
            set_local_hover(&mut hover, label.clone(), zone.clone());

            if !pressed(pointer.mask) {
                if let Some(zone) = zone {
                    let same = is_drag_source(&label, &zone);
                    let mut handled = false;
                    if !same {
                        match drag_source_pair() {
                            Some((source_label, source_id)) => {
                                crate::slots::move_slot(&source_label, &source_id, &label, &zone, path);
                            }
                            // 没有登记来源（前端发起）时按外部文件写入
                            None => crate::slots::drop_paths(&label, &zone, path),
                        }
                        handled = true;
                    }
                    *last_drop().lock().unwrap_or_else(|error| error.into_inner()) =
                        Some((label.clone(), zone, same, handled));
                    dropped = true;
                }
                break;
            }
        } else {
            clear_local_hover(&mut hover);
            if let Some(target) = target {
                let version = aware_version(&conn, atoms, target).unwrap_or(0);
                let changed = current.as_ref().map(|external| external.win) != Some(target);
                if changed {
                    if let Some(old) = current.take() {
                        send_leave(&conn, atoms, win, old.win);
                    }
                    send_enter(&conn, atoms, win, target);
                    current = Some(External { win: target, version, accepted: false });
                    sent_position = (i32::MIN, i32::MIN);
                }
                if sent_position != (x, y) && sent_at.elapsed() >= Duration::from_millis(50) {
                    send_position(&conn, atoms, win, target, x, y, stamp);
                    sent_position = (x, y);
                    sent_at = Instant::now();
                }
                if !pressed(pointer.mask) {
                    let mut accepted = current.as_ref().map(|external| external.accepted).unwrap_or(false);
                    // 刚进入目标就松手时给 Status 留一点时间，避免误判为取消
                    if !accepted {
                        let deadline = Instant::now() + Duration::from_millis(250);
                        while !accepted && Instant::now() < deadline {
                            drain(&conn, win, atoms, &uri, &mut stamp, &mut current);
                            accepted = current.as_ref().map(|external| external.accepted).unwrap_or(false);
                            std::thread::sleep(Duration::from_millis(4));
                        }
                    }
                    if accepted {
                        // 最后一次位置必须送达，落点才会落在松手处
                        send_position(&conn, atoms, win, target, x, y, stamp);
                        send_drop(&conn, atoms, win, target, stamp);
                        let version = current.as_ref().map(|external| external.version).unwrap_or(0);
                        current = None;
                        dropped = if version >= 5 {
                            wait_finished(&conn, atoms, win, &uri, &mut stamp)
                        } else {
                            true
                        };
                    } else {
                        send_leave(&conn, atoms, win, target);
                    }
                    break;
                }
            } else {
                if let Some(old) = current.take() {
                    send_leave(&conn, atoms, win, old.win);
                }
                if !pressed(pointer.mask) {
                    break;
                }
            }
        }

        std::thread::sleep(Duration::from_millis(10));
    }

    clear_local_hover(&mut hover);
    if let Some(old) = current.take() {
        send_leave(&conn, atoms, win, old.win);
    }
    hide_icon();
    let _ = conn.flush();
    dropped
}

fn set_local_hover(hover: &mut Option<(String, String)>, label: String, zone: Option<String>) {
    let next = zone.map(|zone| (label, zone));
    if *hover == next {
        return;
    }
    clear_local_hover(hover);
    if let Some((label, zone)) = &next {
        report_hover(label, Some(zone));
    }
    *hover = next;
}

fn clear_local_hover(hover: &mut Option<(String, String)>) {
    if let Some((label, _)) = hover.take() {
        report_hover(&label, None);
    }
}

fn drain(
    conn: &RustConnection,
    win: Window,
    atoms: &Atoms,
    uri: &[u8],
    stamp: &mut u32,
    current: &mut Option<External>,
) {
    while let Ok(Some(event)) = conn.poll_for_event() {
        match event {
            XEvent::SelectionRequest(request) => serve(conn, atoms, uri, request),
            XEvent::ClientMessage(message) if message.window == win => {
                let data = message.data.as_data32();
                if message.type_ == atoms.status {
                    if let Some(external) = current.as_mut() {
                        if external.win == data[0] {
                            external.accepted = data[1] & 1 != 0;
                        }
                    }
                }
            }
            XEvent::PropertyNotify(event) if event.window == win && event.atom == atoms.time => {
                *stamp = event.time;
            }
            _ => {}
        }
    }
}

/// 等待落点确认，期间继续提供选区数据。
fn wait_finished(conn: &RustConnection, atoms: &Atoms, win: Window, uri: &[u8], stamp: &mut u32) -> bool {
    let deadline = Instant::now() + Duration::from_millis(1500);
    loop {
        while let Ok(Some(event)) = conn.poll_for_event() {
            match event {
                XEvent::SelectionRequest(request) => serve(conn, atoms, uri, request),
                XEvent::ClientMessage(message) if message.window == win => {
                    if message.type_ == atoms.finished {
                        return message.data.as_data32()[1] & 1 != 0;
                    }
                }
                XEvent::PropertyNotify(event) if event.window == win && event.atom == atoms.time => {
                    *stamp = event.time;
                }
                _ => {}
            }
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(4));
    }
}

/// 应答选区请求：TARGETS 与文本类型给数据，其余拒绝。
fn serve(conn: &RustConnection, atoms: &Atoms, uri: &[u8], request: SelectionRequestEvent) {
    if request.selection != atoms.selection {
        return;
    }
    let property = if request.property != 0 { request.property } else { request.target };
    let answered = if request.target == atoms.targets {
        let list = [atoms.targets, atoms.uri_list];
        let mut data = Vec::with_capacity(list.len() * 4);
        for atom in list {
            data.extend_from_slice(&atom.to_ne_bytes());
        }
        conn.change_property(
            PropMode::REPLACE,
            request.requestor,
            property,
            AtomEnum::ATOM,
            32,
            list.len() as u32,
            &data,
        )
        .is_ok()
    } else if request.target == atoms.uri_list {
        conn.change_property(
            PropMode::REPLACE,
            request.requestor,
            property,
            request.target,
            8,
            uri.len() as u32,
            uri,
        )
        .is_ok()
    } else {
        false
    };

    let notify = SelectionNotifyEvent {
        response_type: SELECTION_NOTIFY_EVENT,
        sequence: 0,
        time: request.time,
        requestor: request.requestor,
        selection: request.selection,
        target: request.target,
        property: if answered { property } else { 0 },
    };
    let _ = conn.send_event(false, request.requestor, EventMask::NO_EVENT, notify);
    let _ = conn.flush();
}

fn send_enter(conn: &RustConnection, atoms: &Atoms, win: Window, target: Window) {
    let data = [win, VERSION << 24, atoms.uri_list, 0, 0];
    send(conn, target, atoms.enter, data);
}

fn send_position(
    conn: &RustConnection,
    atoms: &Atoms,
    win: Window,
    target: Window,
    x: i32,
    y: i32,
    stamp: u32,
) {
    let data = [win, 0, pack(x, y), stamp, atoms.copy];
    send(conn, target, atoms.position, data);
}

fn send_leave(conn: &RustConnection, atoms: &Atoms, win: Window, target: Window) {
    send(conn, target, atoms.leave, [win, 0, 0, 0, 0]);
}

fn send_drop(conn: &RustConnection, atoms: &Atoms, win: Window, target: Window, stamp: u32) {
    send(conn, target, atoms.drop, [win, 0, stamp, 0, 0]);
}

fn send(conn: &RustConnection, target: Window, type_: u32, data: [u32; 5]) {
    let event = ClientMessageEvent::new(32, target, type_, data);
    let _ = conn.send_event(false, target, EventMask::NO_EVENT, event);
    let _ = conn.flush();
}

fn show_icon(sprite: &Sprite, x: i32, y: i32) {
    crate::hud::dragicon::show(DRAG_OWNER, sprite, x, y);
}

fn hide_icon() {
    crate::hud::dragicon::hide(DRAG_OWNER);
}

fn query(conn: &RustConnection, win: Window) -> Option<x11rb::protocol::xproto::QueryPointerReply> {
    conn.query_pointer(win).ok()?.reply().ok()
}

fn pressed(mask: KeyButMask) -> bool {
    mask.contains(KeyButMask::BUTTON1) || mask.contains(KeyButMask::BUTTON3)
}

/// 属性变化带回服务器时间，避免用 CurrentTime 抢选区。
fn fresh_time(conn: &RustConnection, win: Window, atoms: &Atoms) -> u32 {
    bump_time(conn, win, atoms);
    let _ = conn.flush();
    let deadline = Instant::now() + Duration::from_millis(250);
    while Instant::now() < deadline {
        match conn.poll_for_event() {
            Ok(Some(XEvent::PropertyNotify(event))) if event.window == win && event.atom == atoms.time => {
                return event.time;
            }
            Ok(Some(_)) => {}
            Ok(None) => std::thread::sleep(Duration::from_millis(2)),
            Err(_) => break,
        }
    }
    0
}

fn bump_time(conn: &RustConnection, win: Window, atoms: &Atoms) {
    static COUNTER: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
    let value = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let _ = conn.change_property(PropMode::REPLACE, win, atoms.time, AtomEnum::CARDINAL, 8, 1, &[value]);
    let _ = conn.flush();
}

fn aware_version(conn: &RustConnection, atoms: &Atoms, win: Window) -> Option<u32> {
    let reply = conn.get_property(false, win, atoms.aware, AtomEnum::ATOM, 0, 1).ok()?.reply().ok()?;
    let version = reply.value32()?.next();
    version
}

/// 指针下最深子窗口后向上找注册了 XdndAware 的窗口。
fn resolve(conn: &RustConnection, atoms: &Atoms, root: Window, start: Window) -> Option<Window> {
    if start == 0 || start == root {
        return None;
    }
    let mut win = start;
    for _ in 0..16 {
        let Some(reply) = query(conn, win) else { break };
        if reply.child == 0 {
            break;
        }
        win = reply.child;
    }
    let helpers = helpers().lock().unwrap_or_else(|error| error.into_inner());
    loop {
        if win == 0 || win == root {
            return None;
        }
        if !helpers.contains(&win) && aware_version(conn, atoms, win).is_some() {
            return Some(win);
        }
        let tree = conn.query_tree(win).ok()?.reply().ok()?;
        if tree.parent == 0 || tree.parent == root {
            return None;
        }
        win = tree.parent;
    }
}

fn pack(x: i32, y: i32) -> u32 {
    ((x as u16 as u32) << 16) | (y as u16 as u32)
}

fn encode_uri(path: &str) -> String {
    let mut out = String::from("file://");
    for &byte in path.as_bytes() {
        let plain = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/' | b':');
        if plain {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// 取第一行有效 URI；支持 CRLF/LF 分隔与百分号编码，忽略非本地文件。
fn decode_uri(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    for line in text.split(['\r', '\n']) {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(path) = file_path(line) {
            return Some(path);
        }
    }
    None
}

fn file_path(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    if !rest.starts_with('/') {
        return None;
    }
    let bytes = rest.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = (bytes[index + 1] as char).to_digit(16)?;
            let low = (bytes[index + 2] as char).to_digit(16)?;
            out.push((high * 16 + low) as u8);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    Some(String::from_utf8_lossy(&out).into_owned())
}

/// 其余窗口不接受外部文件，保持与 Windows 之外的平台一致。
pub fn install_all(_: &AppHandle) {}
