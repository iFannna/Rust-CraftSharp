//! X11 后端：ARGB 覆盖窗口、位图提交、输入形状与鼠标事件。
//! 首版覆盖 HUD 的显示、置底与指针交互，键盘与全局钩子后续接入。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use x11rb::connection::Connection;
use x11rb::protocol::shape::{ConnectionExt as ShapeExt, SK, SO};
use x11rb::protocol::xproto::{
    AtomEnum, ClientMessageEvent, ClipOrdering, ColormapAlloc, ConfigureWindowAux, ConnectionExt,
    CreateGCAux, CreateWindowAux, EventMask, GrabMode, ImageFormat, InputFocus, PropMode, Rectangle,
    StackMode, VisualClass, Window, WindowClass,
};
use x11rb::protocol::Event as XEvent;
use x11rb::rust_connection::RustConnection;

use crate::hud::host::{Area, Event, Options, Point};
use crate::hud::sprite::Frame;
use crate::keys_x11::key_map;

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn attach_app(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

pub fn ticks() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

pub struct Host {
    conn: Arc<RustConnection>,
    win: Window,
    gc: u32,
    screen: usize,
    dispatch: fn(Event),
    app: AppHandle,
    click_through: bool,
    managed: bool,
    panel: bool,
    band: f32,
    size: (u16, u16),
    mask: Vec<Rectangle>,
    root: Window,
    timers: Mutex<HashMap<usize, Arc<AtomicBool>>>,
}

impl Host {
    pub fn create(
        class: &str,
        title: &str,
        options: Options,
        dispatch: fn(Event),
    ) -> Option<Self> {
        let app = APP.get()?.clone();
        let (conn, screen) = x11rb::connect(None).ok()?;
        let root = conn.setup().roots[screen].root;
        let depth = conn.setup().roots[screen]
            .allowed_depths
            .iter()
            .find(|depth| depth.depth == 32)?;
        let visual = depth
            .visuals
            .iter()
            .find(|visual| visual.class == VisualClass::TRUE_COLOR)?
            .visual_id;

        // 桌面层与浮层面板交给窗口管理器；置顶浮层保持 override-redirect
        let managed = options.desktop || options.panel;

        let win = conn.generate_id().ok()?;
        let colormap = conn.generate_id().ok()?;
        conn.create_colormap(ColormapAlloc::NONE, colormap, root, visual).ok()?.check().ok()?;
        let aux = CreateWindowAux::new()
            // 不设背景：映射与重挂载时服务器不会用背景色抹掉已提交的画面
            .background_pixmap(x11rb::NONE)
            .border_pixel(0)
            .colormap(colormap)
            .override_redirect(if managed { 0 } else { 1 });
        conn.create_window(
            32,
            win,
            root,
            0,
            0,
            1,
            1,
            0,
            WindowClass::INPUT_OUTPUT,
            visual,
            &aux,
        )
        .ok()?
        .check()
        .ok()?;

        let gc = conn.generate_id().ok()?;
        conn.create_gc(gc, win, &CreateGCAux::new()).ok()?.check().ok()?;

        set_atoms(
            &conn,
            win,
            class,
            title,
            options.desktop,
            options.panel,
            managed,
            !options.click_through,
        );
        if options.click_through {
            crate::dragdrop::register_helper(win);
        }
        let conn = Arc::new(conn);
        let host = Self {
            conn,
            win,
            gc,
            screen,
            dispatch,
            app,
            click_through: options.click_through,
            managed,
            panel: options.panel,
            band: 0.0,
            size: (1, 1),
            mask: Vec::new(),
            root,
            timers: Mutex::new(HashMap::new()),
        };
        host.apply_input_shape();
        if !managed {
            if options.desktop {
                host.park();
            } else {
                host.raise();
            }
        }
        host.spawn_events();
        host.conn.flush().ok()?;
        Some(host)
    }

    pub fn install_drop(&self, app: &AppHandle, label: &str) {
        crate::dragdrop::install(app, label, self.win, self.conn.clone(), self.root);
    }

    pub fn install_input(&self) {}

    pub fn dpi(&self) -> f32 {
        xft_dpi(&self.conn, self.root).unwrap_or(1.0).max(1.0)
    }

    pub fn work_area(&self) -> Area {
        let screen = &self.conn.setup().roots[self.screen];
        if let Some((left, top, width, height)) = net_workarea(&self.conn, self.root) {
            return Area {
                left,
                top,
                right: left + width as i32,
                bottom: top + height as i32,
            };
        }
        Area {
            left: 0,
            top: 0,
            right: screen.width_in_pixels as i32,
            bottom: screen.height_in_pixels as i32,
        }
    }

    pub fn primary_area(&self) -> Area {
        let screen = &self.conn.setup().roots[self.screen];
        Area {
            left: 0,
            top: 0,
            right: screen.width_in_pixels as i32,
            bottom: screen.height_in_pixels as i32,
        }
    }

    pub fn cursor(&self) -> Point {
        self.conn
            .query_pointer(self.root)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map(|reply| Point { x: reply.root_x as i32, y: reply.root_y as i32 })
            .unwrap_or_default()
    }

    pub fn present(&mut self, frame: &Frame, x: i32, y: i32) {
        self.present_pixels(frame.width, frame.height, &frame.pixels, x, y);
    }

    pub fn present_pixels(&mut self, width: u32, height: u32, pixels: &[u32], x: i32, y: i32) {
        if width == 0 || height == 0 || pixels.len() < (width * height) as usize {
            return;
        }
        let width = width as u16;
        let height = height as u16;
        if self.size != (width, height) {
            self.size = (width, height);
            self.apply_input_shape();
        }
        let aux = ConfigureWindowAux::new()
            .x(x)
            .y(y)
            .width(width as u32)
            .height(height as u32);
        let _ = self.conn.configure_window(self.win, &aux);
        // SAFETY: 预乘 ARGB 的 u32 与 X11 32 位像素内存布局一致，长度已核对
        let bytes = unsafe {
            std::slice::from_raw_parts(pixels.as_ptr() as *const u8, pixels.len() * 4)
        };
        {
            let _ = self.conn.put_image(
                ImageFormat::Z_PIXMAP,
                self.win,
                self.gc,
                width,
                height,
                0,
                0,
                0,
                32,
                bytes,
            );
            let _ = self.conn.flush();
        }
        self.update_input_mask(pixels, width, height);
        let _ = self.conn.flush();
    }

    pub fn set_band(&mut self, band: f32) {
        self.band = band;
    }

    pub fn show(&self) {
        let _ = self.conn.map_window(self.win);
        let _ = self.conn.flush();
        if self.panel {
            // 映射前的初始状态会被 mutter 覆盖，映射后按 EWMH 再声明一次置顶
            set_state(&self.conn, self.root, self.win, true);
            self.raise();
        }
    }

    pub fn hide(&self) {
        let _ = self.conn.unmap_window(self.win);
        let _ = self.conn.flush();
    }

    pub fn park(&self) {
        if self.managed {
            // Wayland 下可交互桌面窗不能带 BELOW 状态，否则收不到指针，改用分页器置底
            if !self.panel && !self.click_through && crate::wayland_session() {
                lower(&self.conn, self.root, self.win);
            }
            return;
        }
        let aux = ConfigureWindowAux::new().stack_mode(StackMode::BELOW);
        let _ = self.conn.configure_window(self.win, &aux);
        set_below(&self.conn, self.win, true);
        let _ = self.conn.flush();
    }

    pub fn raise(&self) {
        if self.panel {
            restack(&self.conn, self.root, self.win, 0);
            return;
        }
        if self.managed {
            return;
        }
        let aux = ConfigureWindowAux::new().stack_mode(StackMode::ABOVE);
        let _ = self.conn.configure_window(self.win, &aux);
        set_below(&self.conn, self.win, false);
        let _ = self.conn.flush();
    }

    /// 把别的受管窗口提到本窗口之上（实体预览覆盖层）
    pub fn restack_above(&self, xid: u32) {
        restack(&self.conn, self.root, xid, 0);
    }

    /// 浮层面板取键盘焦点处理局部快捷键；先经 WM 激活，否则会被焦点策略改回
    pub fn focus(&self) {
        if self.panel {
            if let Some(atom) = intern(&self.conn, "_NET_ACTIVE_WINDOW") {
                let event = ClientMessageEvent::new(32, self.win, atom, [2, 0, 0, 0, 0]);
                let _ = self.conn.send_event(
                    false,
                    self.root,
                    EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                    event,
                );
            }
        }
        let _ = self.conn.set_input_focus(InputFocus::PARENT, self.win, 0u32);
        let _ = self.conn.flush();
    }

    pub fn set_layer(&self, desktop: bool) {
        if desktop {
            self.park();
        } else {
            self.raise();
        }
    }

    pub fn drop_topmost(&self) {
        self.park();
    }

    pub fn capture(&self) {
        let _ = self.conn.grab_pointer(
            false,
            self.win,
            EventMask::BUTTON_PRESS | EventMask::BUTTON_RELEASE | EventMask::POINTER_MOTION,
            GrabMode::ASYNC,
            GrabMode::ASYNC,
            0u32,
            0u32,
            0u32,
        );
        let _ = self.conn.flush();
    }

    pub fn release(&self) {
        let _ = self.conn.ungrab_pointer(0u32);
        let _ = self.conn.flush();
    }

    pub fn track_leave(&self) {}

    pub fn contains(&self, x: i32, y: i32) -> bool {
        let Some(reply) = self
            .conn
            .translate_coordinates(self.win, self.root, 0, 0)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
        else {
            return false;
        };
        x >= reply.dst_x as i32
            && y >= reply.dst_y as i32
            && x < reply.dst_x as i32 + self.size.0 as i32
            && y < reply.dst_y as i32 + self.size.1 as i32
    }

    pub fn to_client(&self, x: i32, y: i32) -> Point {
        self.conn
            .translate_coordinates(self.root, self.win, x as i16, y as i16)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map(|reply| Point { x: reply.dst_x as i32, y: reply.dst_y as i32 })
            .unwrap_or_default()
    }

    pub fn to_screen(&self, x: i32, y: i32) -> Point {
        self.conn
            .translate_coordinates(self.win, self.root, x as i16, y as i16)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map(|reply| Point { x: reply.dst_x as i32, y: reply.dst_y as i32 })
            .unwrap_or_default()
    }

    pub fn timer(&self, id: usize, interval: u32, active: bool) {
        let mut timers = self.timers.lock().unwrap_or_else(|error| error.into_inner());
        if !active {
            if let Some(flag) = timers.remove(&id) {
                flag.store(true, Ordering::Relaxed);
            }
            return;
        }
        if timers.contains_key(&id) {
            return;
        }
        let flag = Arc::new(AtomicBool::new(false));
        timers.insert(id, flag.clone());
        let app = self.app.clone();
        let dispatch = self.dispatch;
        std::thread::spawn(move || {
            while !flag.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(interval as u64));
                if flag.load(Ordering::Relaxed) {
                    break;
                }
                let app = app.clone();
                let _ = app.run_on_main_thread(move || dispatch(Event::Timer(id)));
            }
        });
    }

    fn apply_input_shape(&self) {
        let rects = if self.click_through {
            Vec::new()
        } else if self.band > 0.0 {
            vec![Rectangle {
                x: 0,
                y: self.band.round() as i16,
                width: self.size.0,
                height: self.size.1.saturating_sub(self.band.round() as u16),
            }]
        } else {
            vec![Rectangle { x: 0, y: 0, width: self.size.0, height: self.size.1 }]
        };
        let _ = self.conn.shape_rectangles(
            SO::SET,
            SK::INPUT,
            ClipOrdering::UNSORTED,
            self.win,
            0,
            0,
            &rects,
        );
        let _ = self.conn.flush();
    }

    /// 按像素透明度生成输入区域，透明处让给下层窗口
    fn update_input_mask(&mut self, pixels: &[u32], width: u16, height: u16) {
        if self.click_through {
            return;
        }
        let stride = width as usize;
        let top = (self.band.max(0.0).ceil() as usize).min(height as usize);
        let mut rects = Vec::new();
        for y in top..height as usize {
            let row = &pixels[y * stride..(y + 1) * stride];
            let mut x = 0;
            while x < stride {
                while x < stride && row[x] >> 24 == 0 {
                    x += 1;
                }
                if x == stride {
                    break;
                }
                let start = x;
                while x < stride && row[x] >> 24 != 0 {
                    x += 1;
                }
                rects.push(Rectangle {
                    x: start as i16,
                    y: y as i16,
                    width: (x - start) as u16,
                    height: 1,
                });
            }
        }
        let changed = rects.len() != self.mask.len()
            || rects
                .iter()
                .zip(self.mask.iter())
                .any(|(next, prev)| next.x != prev.x || next.y != prev.y || next.width != prev.width);
        if changed {
            self.mask = rects;
            self.apply_mask();
        }
    }

    fn apply_mask(&self) {
        let _ = self.conn.shape_rectangles(
            SO::SET,
            SK::INPUT,
            ClipOrdering::UNSORTED,
            self.win,
            0,
            0,
            &self.mask,
        );
        let _ = self.conn.flush();
    }

    fn spawn_events(&self) {
        if self.click_through {
            return;
        }
        let Ok((event_conn, _)) = x11rb::connect(None) else { return };
        let mask = EventMask::POINTER_MOTION
            | EventMask::BUTTON_PRESS
            | EventMask::BUTTON_RELEASE
            | EventMask::ENTER_WINDOW
            | EventMask::LEAVE_WINDOW
            | EventMask::KEY_PRESS
            | EventMask::KEY_RELEASE;
        let _ = event_conn.change_window_attributes(
            self.win,
            &x11rb::protocol::xproto::ChangeWindowAttributesAux::new().event_mask(mask),
        );
        let _ = event_conn.flush();
        let app = self.app.clone();
        let dispatch = self.dispatch;
        let win = self.win;
        let root = self.root;
        // 点击会让合成器把普通层窗口提到最前，处理完按键立即压回底部
        let sink = !self.click_through && self.managed && !self.panel && crate::wayland_session();
        let keys = key_map(&event_conn);
        std::thread::spawn(move || loop {
            let Ok(event) = event_conn.wait_for_event() else { break };
            if let XEvent::ButtonPress(event) = &event {
                if event.detail == 1 {
                    // 点击状态栏取得键盘焦点，Esc 或点击别处由窗口管理器收回
                    let _ = event_conn.set_input_focus(InputFocus::PARENT, win, 0u32);
                    let _ = event_conn.flush();
                }
            }
            if sink && matches!(&event, XEvent::ButtonPress(_)) {
                lower(&event_conn, root, win);
            }
            let Some(event) = translate(event, &keys) else { continue };
            let app = app.clone();
            let _ = app.run_on_main_thread(move || dispatch(event));
        });
    }
}

fn translate(
    event: XEvent,
    keys: &std::collections::HashMap<u8, u32>,
) -> Option<Event> {
    match event {
        XEvent::MotionNotify(event) => {
            Some(Event::Move(event.event_x as f32, event.event_y as f32))
        }
        XEvent::LeaveNotify(_) => Some(Event::Leave),
        XEvent::ButtonPress(event) => match event.detail {
            1 => Some(Event::Down(event.event_x as f32, event.event_y as f32)),
            4 => Some(Event::Wheel(120)),
            5 => Some(Event::Wheel(-120)),
            _ => None,
        },
        XEvent::ButtonRelease(event) => match event.detail {
            1 => Some(Event::Up(event.event_x as f32, event.event_y as f32)),
            3 => Some(Event::Menu(event.event_x as f32, event.event_y as f32)),
            _ => None,
        },
        XEvent::KeyPress(event) => keys.get(&event.detail).map(|key| Event::KeyDown(*key)),
        XEvent::KeyRelease(event) => keys.get(&event.detail).map(|key| Event::KeyUp(*key)),
        _ => None,
    }
}

fn intern(conn: &RustConnection, name: &str) -> Option<u32> {
    conn.intern_atom(false, name.as_bytes()).ok()?.reply().ok().map(|reply| reply.atom)
}

/// 映射后追加置顶状态；属性写在映射前会被 mutter 的状态同步覆盖
fn set_state(conn: &RustConnection, root: Window, win: Window, above: bool) {
    let Some(prop) = intern(conn, "_NET_WM_STATE") else { return };
    let name = if above { "_NET_WM_STATE_ABOVE" } else { "_NET_WM_STATE_BELOW" };
    let Some(atom) = intern(conn, name) else { return };
    let event = ClientMessageEvent::new(32, win, prop, [1, atom, 0, 2, 0]);
    let _ = conn.send_event(
        false,
        root,
        EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
        event,
    );
    let _ = conn.flush();
}

/// 分页器身份的 EWMH 重排；普通 ConfigureRequest 会被 mutter 丢弃
pub fn restack(conn: &RustConnection, root: Window, win: Window, detail: u32) {
    let Some(atom) = intern(conn, "_NET_RESTACK_WINDOW") else {
        return;
    };
    let event = ClientMessageEvent::new(32, win, atom, [2, 0, detail, 0, 0]);
    let _ = conn.send_event(
        false,
        root,
        EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
        event,
    );
    let _ = conn.flush();
}

/// 把任意受管窗口提到同类窗口最上层，菜单等独立弹窗使用
pub fn restack_top(xid: u32) {
    let Ok((conn, screen)) = x11rb::connect(None) else { return };
    let root = conn.setup().roots[screen].root;
    restack(&conn, root, xid, 0);
}

/// EWMH 置底：Wayland 下桌面窗不能带 BELOW 状态，用分页器请求压到普通层最下面
fn lower(conn: &RustConnection, root: Window, win: Window) {
    let Some(atom) = intern(conn, "_NET_RESTACK_WINDOW") else {
        return;
    };
    // data.l[1] 为 detail（Below），data.l[2] 为 sibling（None）
    let event = ClientMessageEvent::new(32, win, atom, [2, 1, 0, 0, 0]);
    let _ = conn.send_event(
        false,
        root,
        EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
        event,
    );
    let _ = conn.flush();
}

fn set_atoms(
    conn: &RustConnection,
    win: Window,
    class: &str,
    title: &str,
    desktop: bool,
    panel: bool,
    managed: bool,
    interactive: bool,
) {
    let utf8 = intern(conn, "UTF8_STRING").unwrap_or(AtomEnum::STRING.into());
    if let Some(atom) = intern(conn, "_NET_WM_NAME") {
        let _ = conn.change_property(
            PropMode::REPLACE,
            win,
            atom,
            utf8,
            8,
            title.len() as u32,
            title.as_bytes(),
        );
    }
    if let Some(atom) = intern(conn, "WM_CLASS") {
        let value = format!("{class}\0{class}\0");
        let _ = conn.change_property(
            PropMode::REPLACE,
            win,
            atom,
            AtomEnum::STRING,
            8,
            value.len() as u32,
            value.as_bytes(),
        );
    }
    let kind = if desktop {
        if interactive && crate::wayland_session() {
            // mutter 不向 XWayland 的 DESKTOP 窗口转发指针，换成置底的普通窗口
            "_NET_WM_WINDOW_TYPE_NORMAL"
        } else {
            "_NET_WM_WINDOW_TYPE_DESKTOP"
        }
    } else if panel {
        // 菜单类窗口 mutter 不播开窗动画，浮层直接出现
        "_NET_WM_WINDOW_TYPE_MENU"
    } else {
        "_NET_WM_WINDOW_TYPE_UTILITY"
    };
    if let (Some(prop), Some(atom)) = (intern(conn, "_NET_WM_WINDOW_TYPE"), intern(conn, kind)) {
        let _ = conn.change_property(
            PropMode::REPLACE,
            win,
            prop,
            AtomEnum::ATOM,
            32,
            1,
            &atom.to_ne_bytes(),
        );
    }
    if managed {
        if desktop {
            let mut states = vec![
                "_NET_WM_STATE_STICKY",
                "_NET_WM_STATE_SKIP_TASKBAR",
                "_NET_WM_STATE_SKIP_PAGER",
            ];
            // mutter 不向 BELOW 的 XWayland 窗口转发指针，可交互桌面窗停在普通层由 park 置底
            if !(interactive && crate::wayland_session()) {
                states.insert(0, "_NET_WM_STATE_BELOW");
            }
            set_states(conn, win, &states);
            if let Some(prop) = intern(conn, "_NET_WM_DESKTOP") {
                let _ = conn.change_property(
                    PropMode::REPLACE,
                    win,
                    prop,
                    AtomEnum::CARDINAL,
                    32,
                    1,
                    &u32::MAX.to_ne_bytes(),
                );
            }
        } else {
            set_states(
                conn,
                win,
                &[
                    "_NET_WM_STATE_ABOVE",
                    "_NET_WM_STATE_SKIP_TASKBAR",
                    "_NET_WM_STATE_SKIP_PAGER",
                ],
            );
        }
        if let Some(prop) = intern(conn, "_NET_WM_PID") {
            let _ = conn.change_property(
                PropMode::REPLACE,
                win,
                prop,
                AtomEnum::CARDINAL,
                32,
                1,
                &std::process::id().to_ne_bytes(),
            );
        }
        if let Some(prop) = intern(conn, "_MOTIF_WM_HINTS") {
            let mut data = Vec::with_capacity(20);
            for value in [2u32, 0, 0, 0, 0] {
                data.extend_from_slice(&value.to_ne_bytes());
            }
            let _ = conn.change_property(PropMode::REPLACE, win, prop, prop, 32, 5, &data);
        }
    }
}

fn set_states(conn: &RustConnection, win: Window, names: &[&str]) {
    let Some(prop) = intern(conn, "_NET_WM_STATE") else {
        return;
    };
    let atoms: Vec<u32> = names.iter().filter_map(|name| intern(conn, name)).collect();
    let mut data = Vec::with_capacity(atoms.len() * 4);
    for atom in &atoms {
        data.extend_from_slice(&atom.to_ne_bytes());
    }
    let _ = conn.change_property(
        PropMode::REPLACE,
        win,
        prop,
        AtomEnum::ATOM,
        32,
        atoms.len() as u32,
        &data,
    );
}

fn set_below(conn: &RustConnection, win: Window, below: bool) {
    let Some(prop) = intern(conn, "_NET_WM_STATE") else { return };
    let Some(atom) = intern(conn, if below { "_NET_WM_STATE_BELOW" } else { "_NET_WM_STATE_ABOVE" }) else {
        return;
    };
    let _ = conn.change_property(
        PropMode::REPLACE,
        win,
        prop,
        AtomEnum::ATOM,
        32,
        1,
        &atom.to_ne_bytes(),
    );
}

fn net_workarea(conn: &RustConnection, root: Window) -> Option<(i32, i32, u32, u32)> {
    let atom = intern(conn, "_NET_WORKAREA")?;
    let reply = conn
        .get_property(false, root, atom, AtomEnum::CARDINAL, 0, 4)
        .ok()?
        .reply()
        .ok()?;
    let values: Vec<u32> = reply.value32()?.collect();
    if values.len() < 4 {
        return None;
    }
    Some((values[0] as i32, values[1] as i32, values[2], values[3]))
}

fn xft_dpi(conn: &RustConnection, root: Window) -> Option<f32> {
    let screen = &conn.setup().roots[0];
    let atom = intern(conn, "RESOURCE_MANAGER")?;
    let reply = conn
        .get_property(false, root, atom, AtomEnum::STRING, 0, 4096)
        .ok()?
        .reply()
        .ok()?;
    let text = String::from_utf8_lossy(&reply.value);
    for line in text.lines() {
        if let Some(value) = line.trim().strip_prefix("Xft.dpi:") {
            if let Ok(dpi) = value.trim().parse::<f32>() {
                return Some(dpi / 96.0);
            }
        }
    }
    let mm = screen.width_in_millimeters.max(1) as f32;
    Some(screen.width_in_pixels as f32 / mm * 25.4 / 96.0)
}
