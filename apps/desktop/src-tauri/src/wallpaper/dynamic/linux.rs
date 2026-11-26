//! X11 动态壁纸：每块屏一个常驻视频窗口，放在桌面层并让出输入区域。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{AtomEnum, ClientMessageEvent, ConnectionExt, EventMask, Window};
use x11rb::rust_connection::RustConnection;

use super::super::store::Transform;
use super::super::{desktop, display, saved, store, stream};
use super::{Rect, VideoState};

pub use super::super::saved::Saved;

const PAGE: &str = "pages/wallpaper-video.html";
const EVENT: &str = "wallpaper-video";
const REPLY_TIMEOUT: Duration = Duration::from_secs(10);
const X11_REQUIRED: &str = "动态壁纸需要 XWayland 支持";

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl Bounds {
    fn width(self) -> i32 {
        self.right - self.left
    }

    fn height(self) -> i32 {
        self.bottom - self.top
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Spec {
    id: String,
    device: String,
    bounds: Bounds,
    scale: f64,
    transform: Option<Transform>,
    span: Option<Bounds>,
}

#[derive(Clone)]
struct Host {
    window: WebviewWindow,
    xid: u32,
    spec: Spec,
    paused: bool,
}

#[derive(Default)]
struct Engine {
    hosts: Vec<Host>,
    specs: Vec<Spec>,
}

static ENGINE: OnceLock<Mutex<Engine>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
static WATCHDOG: AtomicBool = AtomicBool::new(false);
static SEQ: AtomicU32 = AtomicU32::new(0);

fn engine() -> &'static Mutex<Engine> {
    ENGINE.get_or_init(|| Mutex::new(Engine::default()))
}

pub fn attach(app: &AppHandle) {
    let _ = APP.set(app.clone());
    stream::init(app);
}

/// 动态壁纸窗口落在 X11 桌面层；Wayland 会话由 XWayland 承载
fn x11_session() -> Result<(), String> {
    x11rb::connect(None)
        .map(|_| ())
        .map_err(|_| X11_REQUIRED.into())
}

/// 窗口操作统一切到主线程，调用方等待结果
fn run_main<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle) -> T + Send + 'static,
{
    let app = APP.get().ok_or_else(|| "壁纸引擎尚未就绪".to_string())?;
    let (reply, wait) = mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = reply.send(task(&handle));
    })
    .map_err(|error| format!("壁纸窗口调度失败：{error}"))?;
    wait.recv_timeout(REPLY_TIMEOUT)
        .map_err(|_| "壁纸窗口响应超时".to_string())
}

pub fn apply_monitors(targets: &[(String, PathBuf)]) -> Result<(), String> {
    x11_session()?;
    let targets = targets.to_vec();
    run_main(move |app| apply_targets(app, &targets))?
}

pub fn apply_span(video: &PathBuf, transform: Transform) -> Result<(), String> {
    x11_session()?;
    let id = video_id(video)?;
    run_main(move |app| {
        let monitors = desktop::monitors(app);
        let span = virtual_bounds(&monitors).ok_or_else(|| "没有可用显示器".to_string())?;
        let specs = monitors
            .iter()
            .map(|monitor| Spec {
                id: id.clone(),
                device: monitor.device_path.clone(),
                bounds: bounds_of(monitor),
                scale: monitor.scale_factor,
                transform: Some(transform),
                span: Some(span),
            })
            .collect();
        reconcile(app, specs)
    })?
}

fn apply_targets(app: &AppHandle, targets: &[(String, PathBuf)]) -> Result<(), String> {
    let monitors = desktop::monitors(app);
    let mut specs = Vec::new();
    for (device, video) in targets {
        let monitor = monitors
            .iter()
            .find(|monitor| &monitor.device_path == device)
            .ok_or_else(|| format!("显示器不在线：{device}"))?;
        specs.push(Spec {
            id: video_id(video)?,
            device: device.clone(),
            bounds: bounds_of(monitor),
            scale: monitor.scale_factor,
            transform: None,
            span: None,
        });
    }
    if specs.is_empty() {
        return Err("没有可播放的显示器".into());
    }
    reconcile(app, specs)
}

fn video_id(video: &Path) -> Result<String, String> {
    video
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|id| store::file_id(id).is_ok())
        .map(str::to_string)
        .ok_or_else(|| format!("壁纸视频无效：{}", video.display()))
}

pub fn stop_all() {
    if APP.get().is_none() {
        return;
    }
    let _ = run_main(|_| close_all());
}

pub fn stop_devices(devices: &[String]) {
    if devices.is_empty() || APP.get().is_none() {
        return;
    }
    let devices = devices.to_vec();
    let _ = run_main(move |_| close_devices(&devices));
}

pub fn remember(app: &AppHandle, items: &[Saved]) {
    saved::save(app, items);
}

pub fn forget(app: &AppHandle) {
    saved::save(app, &[]);
}

pub fn state(label: &str) -> Option<VideoState> {
    let engine = engine().lock().ok()?;
    let host = engine.hosts.iter().find(|host| host.window.label() == label)?;
    Some(state_of(&host.spec))
}

pub fn restore(app: &AppHandle) {
    if x11_session().is_err() {
        return;
    }
    let items = saved::load(app);
    if items.is_empty() {
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new()
        .name("wallpaper-restore".into())
        .spawn(move || {
            for attempt in 0..20 {
                if attempt > 0 {
                    std::thread::sleep(Duration::from_millis(400));
                }
                let (reply, wait) = mpsc::channel();
                let handle = app.clone();
                let batch = items.clone();
                if app
                    .run_on_main_thread(move || {
                        let _ = reply.send(restore_once(&handle, &batch));
                    })
                    .is_err()
                {
                    return;
                }
                if matches!(wait.recv_timeout(Duration::from_secs(5)), Ok(Ok(true))) {
                    return;
                }
            }
        });
}

fn restore_once(app: &AppHandle, items: &[Saved]) -> Result<bool, String> {
    if x11_session().is_err() {
        return Err(X11_REQUIRED.into());
    }
    let monitors = desktop::monitors(app);
    if monitors.is_empty() {
        return Ok(false);
    }
    let mut specs = Vec::new();
    for item in items {
        let Some(device) = &item.device else {
            continue;
        };
        let Some(monitor) = monitors
            .iter()
            .find(|monitor| &monitor.device_path == device)
        else {
            continue;
        };
        if store::cached_video(app, &item.id).is_none() {
            continue;
        }
        specs.push(Spec {
            id: item.id.clone(),
            device: device.clone(),
            bounds: bounds_of(monitor),
            scale: monitor.scale_factor,
            transform: item.span.then_some(item.transform).flatten(),
            span: if item.span {
                virtual_bounds(&monitors)
            } else {
                None
            },
        });
    }
    if specs.is_empty() {
        return Ok(false);
    }
    reconcile(app, specs)?;
    Ok(true)
}

/// 复用同屏窗口，拓扑或片源变化时原位更新，只有新屏幕才建窗口
fn reconcile(app: &AppHandle, specs: Vec<Spec>) -> Result<(), String> {
    let mut guard = engine().lock().map_err(|_| "壁纸状态不可用".to_string())?;
    let mut old = guard.hosts.clone();
    let mut created = Vec::new();
    let mut next = Vec::new();
    for spec in &specs {
        if let Some(index) = old
            .iter()
            .position(|host| host.spec.device == spec.device)
        {
            let mut host = old.remove(index);
            if let Err(error) = update_host(&host, spec) {
                close_vec(created);
                return Err(error);
            }
            host.spec = spec.clone();
            next.push(host);
        } else {
            match create_host(app, spec) {
                Ok(host) => {
                    created.push(host.clone());
                    next.push(host);
                }
                Err(error) => {
                    close_vec(created);
                    return Err(error);
                }
            }
        }
    }
    close_vec(old);
    guard.hosts = next;
    guard.specs = specs;
    drop(guard);
    ensure_watchdog();
    Ok(())
}

fn update_host(host: &Host, spec: &Spec) -> Result<(), String> {
    let moved = host.spec.bounds != spec.bounds || host.spec.scale != spec.scale;
    if moved {
        place(&host.window, spec)?;
    }
    if moved || host.spec != *spec {
        let _ = host.window.emit(EVENT, state_of(spec));
    }
    Ok(())
}

fn create_host(app: &AppHandle, spec: &Spec) -> Result<Host, String> {
    let label = format!("wallpaper-video-{}", SEQ.fetch_add(1, Ordering::Relaxed) + 1);
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(PAGE.into()))
        .title("CraftSharp 壁纸")
        .position(
            spec.bounds.left as f64 / spec.scale,
            spec.bounds.top as f64 / spec.scale,
        )
        .inner_size(
            spec.bounds.width() as f64 / spec.scale,
            spec.bounds.height() as f64 / spec.scale,
        )
        .decorations(false)
        .shadow(false)
        // Linux 的非可调整窗口会被 GTK 撑到默认高度，必须允许程序改尺寸
        .resizable(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(false)
        .build()
        .map_err(|error| format!("创建壁纸窗口失败：{error}"))?;
    if let Err(error) = prepare_x11(&window) {
        let _ = window.close();
        return Err(error);
    }
    if let Err(error) = window.show() {
        let _ = window.close();
        return Err(format!("显示壁纸窗口失败：{error}"));
    }
    if let Ok(gtk_window) = window.gtk_window() {
        use gtk::prelude::*;
        // GTK 可能连到 Wayland 合成器，show 不会落到 X 桌面层
        if gtk_window.window().is_some_and(|window| {
            window.downcast::<gdkx11::X11Window>().is_err()
        }) {
            let _ = window.close();
            return Err(X11_REQUIRED.into());
        }
        gtk_window.show();
    }
    let xid = match settle_x11(&window) {
        Ok(xid) => xid,
        Err(error) => {
            let _ = window.close();
            return Err(error);
        }
    };
    Ok(Host {
        window,
        xid,
        spec: spec.clone(),
        paused: false,
    })
}

fn place(window: &WebviewWindow, spec: &Spec) -> Result<(), String> {
    let scale = spec.scale;
    window
        .set_position(LogicalPosition::new(
            spec.bounds.left as f64 / scale,
            spec.bounds.top as f64 / scale,
        ))
        .map_err(|error| format!("移动壁纸窗口失败：{error}"))?;
    window
        .set_size(LogicalSize::new(
            spec.bounds.width() as f64 / scale,
            spec.bounds.height() as f64 / scale,
        ))
        .map_err(|error| format!("调整壁纸窗口失败：{error}"))
}

/// 映射前声明桌面层窗口；标题栏、任务栏与点击穿透交给 GTK
fn prepare_x11(window: &WebviewWindow) -> Result<(), String> {
    use gtk::gdk;
    use gtk::prelude::*;

    let gtk_window = window.gtk_window().map_err(|error| error.to_string())?;
    gtk_window.set_type_hint(gdk::WindowTypeHint::Desktop);
    gtk_window.set_skip_taskbar_hint(true);
    gtk_window.set_skip_pager_hint(true);
    gtk_window.set_focus_on_map(false);
    gtk_window.set_accept_focus(false);
    let empty = gtk::cairo::Region::create();
    gtk_window.input_shape_combine_region(Some(&empty));
    gtk_window.realize();
    Ok(())
}

/// 映射完成后补齐所有工作区、清空输入区，并沉到桌面层最底部
fn settle_x11(window: &WebviewWindow) -> Result<u32, String> {
    use gtk::glib::Cast;
    use gtk::prelude::*;

    let gtk_window = window
        .gtk_window()
        .map_err(|_| X11_REQUIRED.to_string())?;
    gtk_window.stick();
    let empty = gtk::cairo::Region::create();
    gtk_window.input_shape_combine_region(Some(&empty));

    let gdk_window = gtk_window
        .window()
        .ok_or_else(|| X11_REQUIRED.to_string())?;
    let x11_window = gdk_window
        .downcast::<gdkx11::X11Window>()
        .map_err(|_| X11_REQUIRED.to_string())?;
    let xid = x11_window.xid() as u32;
    // 桌面图标由独立桌面层窗口绘制，等窗口进入栈后立刻沉到它下面
    let _ = std::thread::Builder::new()
        .name("wallpaper-restack".into())
        .spawn(move || {
            let Ok((conn, screen)) = x11rb::connect(None) else {
                return;
            };
            let root = conn.setup().roots[screen].root;
            for _ in 0..40 {
                if read_stack(&conn, root).is_some_and(|stack| stack.contains(&xid)) {
                    // 映射瞬间的请求可能被 mutter 的入栈覆盖，补发几次
                    for _ in 0..4 {
                        lower(&conn, root, &[xid]);
                        std::thread::sleep(Duration::from_millis(150));
                    }
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        });
    Ok(xid)
}

/// 用分页器身份的 EWMH 请求沉底；普通 ConfigureRequest 会被 mutter 丢弃。
/// data 依次是 source indication、sibling window、detail，sibling 0 表示没有邻窗
fn lower(conn: &RustConnection, root: Window, xids: &[u32]) {
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

fn ensure_watchdog() {
    if WATCHDOG.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(app) = APP.get().cloned() else {
        WATCHDOG.store(false, Ordering::SeqCst);
        return;
    };
    if std::thread::Builder::new()
        .name("wallpaper-watch".into())
        .spawn(move || watch(app))
        .is_err()
    {
        WATCHDOG.store(false, Ordering::SeqCst);
    }
}

/// 每秒跟随显示器拓扑，并在前台全屏时暂停解码
fn watch(app: AppHandle) {
    let Ok((conn, screen)) = x11rb::connect(None) else {
        WATCHDOG.store(false, Ordering::SeqCst);
        return;
    };
    let root = conn.setup().roots[screen].root;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let (idle, xids) = {
            let Ok(guard) = engine().lock() else {
                break;
            };
            let xids = guard.hosts.iter().map(|host| host.xid).collect::<Vec<_>>();
            (guard.specs.is_empty(), xids)
        };
        if idle {
            break;
        }
        if !xids.is_empty() && icons_below(&conn, root, &xids) {
            lower(&conn, root, &xids);
        }
        let cover = fullscreen_cover(&conn, root);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || tick(&handle, cover));
    }
    WATCHDOG.store(false, Ordering::SeqCst);
}

fn tick(app: &AppHandle, cover: Option<Bounds>) {
    let (dirty, toggles, next) = {
        let Ok(mut guard) = engine().lock() else {
            return;
        };
        let monitors = desktop::monitors(app);
        let mut next = Vec::new();
        let mut dirty = false;
        for spec in &guard.specs {
            let Some(monitor) = monitors
                .iter()
                .find(|monitor| monitor.device_path == spec.device)
            else {
                dirty = true;
                continue;
            };
            let span = if spec.span.is_some() {
                virtual_bounds(&monitors)
            } else {
                None
            };
            let bounds = bounds_of(monitor);
            if bounds != spec.bounds || span != spec.span {
                dirty = true;
            }
            next.push(Spec {
                bounds,
                scale: monitor.scale_factor,
                span,
                ..spec.clone()
            });
        }
        if next.len() != guard.specs.len() {
            dirty = true;
        }

        let alive = guard.hosts.len();
        guard
            .hosts
            .retain(|host| app.get_webview_window(host.window.label()).is_some());
        if guard.hosts.len() != alive {
            dirty = true;
        }

        let mut toggles = Vec::new();
        for host in &mut guard.hosts {
            let paused = cover.is_some_and(|rect| covers(rect, host.spec.bounds));
            if paused != host.paused {
                host.paused = paused;
                toggles.push((host.window.clone(), paused));
            }
        }
        (dirty, toggles, next)
    };

    for (window, paused) in toggles {
        let _ = window.eval(&format!("window.__wpPause?.({paused})"));
    }
    if dirty {
        let _ = reconcile(app, next);
    }
}

fn fullscreen_cover(conn: &RustConnection, root: Window) -> Option<Bounds> {
    let active = read32(conn, root, "_NET_ACTIVE_WINDOW")?;
    if active == 0 || active == u32::MAX {
        return None;
    }
    let property = intern(conn, "_NET_WM_STATE")?;
    let fullscreen = intern(conn, "_NET_WM_STATE_FULLSCREEN")?;
    let states: Vec<u32> = conn
        .get_property(false, active, property, AtomEnum::ATOM, 0, 64)
        .ok()?
        .reply()
        .ok()?
        .value32()?
        .collect();
    if !states.contains(&fullscreen) {
        return None;
    }
    let size = conn.get_geometry(active).ok()?.reply().ok()?;
    let origin = conn
        .translate_coordinates(active, root, 0, 0)
        .ok()?
        .reply()
        .ok()?;
    let left = origin.dst_x as i32;
    let top = origin.dst_y as i32;
    Some(Bounds {
        left,
        top,
        right: left + size.width as i32,
        bottom: top + size.height as i32,
    })
}

/// 桌面层的其它窗口（例如桌面图标）压在视频下方时，把视频重新沉底
fn icons_below(conn: &RustConnection, root: Window, xids: &[u32]) -> bool {
    read_stack(conn, root)
        .and_then(|stack| stack.iter().position(|win| xids.contains(win)))
        .is_some_and(|lowest| lowest > 0)
}

fn read_stack(conn: &RustConnection, root: Window) -> Option<Vec<u32>> {
    let atom = intern(conn, "_NET_CLIENT_LIST_STACKING")?;
    let reply = conn
        .get_property(false, root, atom, AtomEnum::WINDOW, 0, 4096)
        .ok()?
        .reply()
        .ok()?;
    reply.value32().map(|values| values.collect())
}

fn read32(conn: &RustConnection, win: Window, name: &str) -> Option<u32> {
    let atom = intern(conn, name)?;
    // _NET_ACTIVE_WINDOW 的类型是 WINDOW，按具体类型取会拿不到数据
    conn.get_property(false, win, atom, AtomEnum::ANY, 0, 1)
        .ok()?
        .reply()
        .ok()?
        .value32()?
        .next()
}

fn intern(conn: &RustConnection, name: &str) -> Option<u32> {
    conn.intern_atom(false, name.as_bytes())
        .ok()?
        .reply()
        .ok()
        .map(|reply| reply.atom)
}

fn covers(window: Bounds, screen: Bounds) -> bool {
    window.left <= screen.left + 2
        && window.top <= screen.top + 2
        && window.right >= screen.right - 2
        && window.bottom >= screen.bottom - 2
}

fn bounds_of(monitor: &desktop::MonitorInfo) -> Bounds {
    Bounds {
        left: monitor.left,
        top: monitor.top,
        right: monitor.right,
        bottom: monitor.bottom,
    }
}

fn virtual_bounds(monitors: &[desktop::MonitorInfo]) -> Option<Bounds> {
    Some(Bounds {
        left: monitors.iter().map(|monitor| monitor.left).min()?,
        top: monitors.iter().map(|monitor| monitor.top).min()?,
        right: monitors.iter().map(|monitor| monitor.right).max()?,
        bottom: monitors.iter().map(|monitor| monitor.bottom).max()?,
    })
}

fn state_of(spec: &Spec) -> VideoState {
    let transform = spec.transform.unwrap_or_default();
    VideoState {
        url: stream::url(&spec.id),
        poster: display::url(&spec.id, "preview"),
        rect: rect_of(spec.bounds),
        virtual_rect: spec.span.map(rect_of),
        zoom: transform.zoom,
        offset_x: transform.offset_x,
        offset_y: transform.offset_y,
    }
}

fn rect_of(bounds: Bounds) -> Rect {
    Rect {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width(),
        height: bounds.height(),
    }
}

fn close_all() {
    if let Ok(mut guard) = engine().lock() {
        guard.specs.clear();
        close_vec(std::mem::take(&mut guard.hosts));
    }
}

fn close_devices(devices: &[String]) {
    let Ok(mut guard) = engine().lock() else {
        return;
    };
    guard.specs.retain(|spec| !devices.contains(&spec.device));
    let mut kept = Vec::new();
    for host in std::mem::take(&mut guard.hosts) {
        if devices.contains(&host.spec.device) {
            let _ = host.window.close();
        } else {
            kept.push(host);
        }
    }
    guard.hosts = kept;
}

fn close_vec(hosts: Vec<Host>) {
    for host in hosts {
        let _ = host.window.close();
    }
}
