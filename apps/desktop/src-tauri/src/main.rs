#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appicon;
mod autostart;
mod desktop;
mod dragdrop;
mod hud;
mod icons;
mod metrics;
mod platform;
mod singleinstance;
mod skins;
mod slots;
mod windowdrag;

#[cfg(windows)]
mod hitmask;

#[cfg(windows)]
mod hotkeys;

/// 给自定义标题栏安装最大化按钮分屏命中。
#[tauri::command]
fn install_caption_hook(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = window.set_maximizable(true);
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        let label = window.label().to_string();
        let hook_app = app.clone();
        app.run_on_main_thread(move || {
            platform::install_caption_hook(hwnd, hook_app, label);
        })
        .map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (app, window);
    }
    Ok(())
}

#[tauri::command]
fn register_hotkeys(app: tauri::AppHandle, actions: Vec<String>) -> Vec<String> {
    #[cfg(windows)]
    {
        hotkeys::register(&app, actions)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, actions);
        Vec::new()
    }
}

/// 获取格子图标，返回目标尺寸的 Data URL；解码与缩放都在后台线程。
#[tauri::command]
async fn slot_icon(path: String, show_target_icon: bool, size: Option<u32>) -> Option<String> {
    let size = size.unwrap_or(32);
    tauri::async_runtime::spawn_blocking(move || icons::data_url(&path, show_target_icon, size))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    platform::open(&path)
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    platform::reveal(&path)
}

#[tauri::command]
fn run_path_as_admin(path: String) -> Result<(), String> {
    platform::run_as_admin(&path)
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    platform::exists(&path)
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    platform::copy_text(&text)
}

#[tauri::command]
fn read_clipboard_paths() -> Vec<String> {
    platform::read_file_paths()
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    platform::rename(&from, &to)
}

/// BOSS 血条数据映射：电池、内存、CPU、GPU 占用，取值 0-1。
#[tauri::command]
async fn system_metrics() -> metrics::SystemMetrics {
    tauri::async_runtime::spawn_blocking(metrics::collect)
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    autostart::set(enabled)
}

/// 更新 HUD 窗口的可命中矩形，透明像素穿透到桌面。
#[tauri::command]
fn set_hit_mask(app: tauri::AppHandle, label: String, runs: Vec<[i32; 4]>) {
    #[cfg(windows)]
    hitmask::update(&app, &label, runs);
    #[cfg(not(windows))]
    let _ = (app, label, runs);
}

/// 自绘窗口拖动，返回拖动结束后的物理像素位置。
#[tauri::command]
async fn drag_window(app: tauri::AppHandle, label: String) -> Option<[i32; 2]> {
    use tauri::Manager;

    let window = app.get_webview_window(&label)?;
    tauri::async_runtime::spawn_blocking(move || windowdrag::drag(&window))
        .await
        .ok()
        .flatten()
        .map(|(x, y)| [x, y])
}

/// 显示或隐藏 Windows 桌面图标。
#[tauri::command]
fn toggle_desktop_icons() -> Result<(), String> {
    desktop::toggle()
}

/// 前端推送状态栏配置，Rust 侧重绘并同步窗口几何。
#[tauri::command]
fn hud_apply(app: tauri::AppHandle, config: hud::HudConfig) {
    hud::apply(&app, config);
}

/// 显示或隐藏原生状态栏窗口。
#[tauri::command]
fn hud_visible(visible: bool) {
    hud::set_visible(visible);
}

/// 控制页推送最终参数，写入磁盘供下次启动原生层直接恢复。
#[tauri::command]
fn hud_cache_write(app: tauri::AppHandle, payload: String) {
    let _ = hud::cache::save(&app, &payload);
}

/// 前端推送物品栏配置，原生窗口重建布局并按需显隐。
#[tauri::command]
fn inventory_apply(config: hud::inventory::InventoryCfg) {
    hud::inventory::apply(config);
}

#[tauri::command]
fn inventory_visible(visible: bool) {
    hud::inventory::set_visible(visible);
}

/// 前端推送准星与攻击指示器配置。
#[tauri::command]
fn crosshair_apply(config: hud::crosshair::CrosshairCfg) {
    hud::crosshair::apply(config);
}

/// 前端推送 BOSS 血条配置。
#[tauri::command]
fn bossbar_apply(bars: Vec<hud::bossbar::BossBarCfg>) {
    hud::bossbar::apply(bars);
}

/// Tooltip 内容、锚点与工作区，坐标均为屏幕物理像素。
#[tauri::command]
fn tooltip_show(
    lines: Vec<hud::tooltip::TooltipLineCfg>,
    unit: f32,
    anchor: hud::tooltip::TooltipAnchor,
    work: hud::tooltip::TooltipWork,
) {
    let lines = hud::tooltip::parse_lines(lines);
    let anchor = hud::tooltip::RectF {
        left: anchor.x,
        top: anchor.y,
        right: anchor.x + anchor.width,
        bottom: anchor.y + anchor.height,
    };
    let work = hud::tooltip::RectF {
        left: work.left,
        top: work.top,
        right: work.right,
        bottom: work.bottom,
    };
    hud::tooltip::show(&lines, unit, &anchor, &work);
}

#[tauri::command]
fn tooltip_hide() {
    hud::tooltip::hide();
}

/// 拖入悬停：快捷栏在原生层直接画，其余窗口交给前端画蒙版。
fn install_drag_hover(app: &tauri::AppHandle) {
    use tauri::Emitter;

    let handle = app.clone();
    dragdrop::set_hover_handler(move |label, zone| {
        match label {
            "hud" => hud::set_drop_hover(zone),
            "inventory" => hud::inventory::set_drop_hover(zone),
            _ => {
                let _ = handle.emit_to(label, "drag-hover", zone.map(str::to_string));
            }
        }
    });
}

/// 前端下发窗口的拖放接受区域，坐标为客户区物理像素。
#[tauri::command]
fn set_drop_zones(label: String, zones: Vec<dragdrop::Zone>) {
    dragdrop::set_zones(&label, zones);
}

/// 把格子文件拖出窗口，交给系统拖放；返回落点，落回原格视为取消。
#[tauri::command]
fn begin_file_drag(
    path: String,
    size: Option<u32>,
    source_window: Option<String>,
    source_zone: Option<String>,
) -> dragdrop::DragResult {
    dragdrop::begin_file_drag(path, size.unwrap_or(32), source_window.zip(source_zone))
}

/// 前端读取一份格子数据快照，窗口只读。
#[tauri::command]
fn slots_snapshot() -> slots::Snapshot {
    slots::snapshot()
}

/// 旧 localStorage 数据一次性迁入，返回是否真的导入。
#[tauri::command]
fn slots_import_legacy(
    slots_json: Option<serde_json::Value>,
    styles_json: Option<serde_json::Value>,
) -> bool {
    let flat = slots_json
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    let styles = styles_json
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    slots::import(flat, styles)
}

/// 窗口注册自己的格子作用域，物品栏切换样式或共享开关时更新。
#[tauri::command]
fn slots_register_scope(label: String, style: String, shared: bool) {
    slots::register_scope(&label, &style, shared);
}

#[tauri::command]
fn slots_set(slot_id: String, item: slots::SlotItem, style: String, shared: bool) {
    slots::set(&slots::Scope::new(style, shared), &slot_id, item);
}

#[tauri::command]
fn slots_clear(slot_id: String, style: String, shared: bool) {
    slots::clear(&slots::Scope::new(style, shared), &slot_id);
}

#[tauri::command]
fn slots_swap(from: String, to: String, style: String, shared: bool) {
    slots::swap(&slots::Scope::new(style, shared), &from, &to);
}

#[tauri::command]
fn slots_move(
    from: String,
    to: String,
    item: slots::SlotItem,
    from_style: String,
    from_shared: bool,
    style: String,
    shared: bool,
) {
    slots::move_between(
        &slots::Scope::new(from_style, from_shared),
        &from,
        &slots::Scope::new(style, shared),
        &to,
        item,
    );
}

#[tauri::command]
fn slots_clear_by_path(path: String, style: String, shared: bool) {
    slots::clear_by_path(&slots::Scope::new(style, shared), &path);
}

/// 自定义皮肤读为 data URL，预览与物品栏共用
#[tauri::command]
fn read_skin_data_url(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
    let image = image::load_from_memory(&bytes).map_err(|error| error.to_string())?;
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(format!("data:image/png;base64,{}", base64(&png)))
}

/// 更换应用图标：托盘、窗口、程序文件与快捷方式一起更新
#[tauri::command]
async fn set_app_icon(app: tauri::AppHandle, png: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || appicon::apply(&app, png))
        .await
        .map_err(|error| error.to_string())?
}

pub(crate) fn base64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], chunk.get(1).copied().unwrap_or(0), chunk.get(2).copied().unwrap_or(0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

pub(crate) fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(data.len() / 4 * 3);
    let mut buf = [0u8; 4];
    let mut n = 0;
    for byte in data.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\r' | b'\n' => continue,
            _ => return Err("invalid base64".into()),
        };
        buf[n] = value;
        n += 1;
        if n == 4 {
            out.push((buf[0] << 2) | (buf[1] >> 4));
            out.push((buf[1] << 4) | (buf[2] >> 2));
            out.push((buf[2] << 6) | buf[3]);
            n = 0;
        }
    }
    match n {
        2 => out.push((buf[0] << 2) | (buf[1] >> 4)),
        3 => {
            out.push((buf[0] << 2) | (buf[1] >> 4));
            out.push((buf[1] << 4) | (buf[2] >> 2));
        }
        _ => {}
    }
    Ok(out)
}

/// 离屏窗口推来的 3D 玩家帧，解码后交给物品栏合成
#[tauri::command]
fn entity_host_frame(data_url: String) {
    let Some(data) = data_url.strip_prefix("data:image/png;base64,") else {
        return;
    };
    let Ok(bytes) = base64_decode(data) else {
        return;
    };
    let Ok(image) = image::load_from_memory(&bytes) else {
        return;
    };
    let rgba = image.to_rgba8();
    hud::inventory::entity_frame(rgba.width(), rgba.height(), rgba.as_raw());
}

#[tauri::command]
fn slots_replace_path(from: String, to: String, style: String, shared: bool) {
    slots::replace_path(&slots::Scope::new(style, shared), &from, &to);
}

fn show_settings(app: &tauri::AppHandle) {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("settings") else {
        return;
    };
    let _ = window.set_skip_taskbar(false);
    let _ = window.show();
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.set_focus();
}

/// 托盘左键切换：收起时直接隐藏，任务栏按钮立即移除；隐藏或最小化时恢复并聚焦。
fn toggle_settings(app: &tauri::AppHandle) {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("settings") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if !visible || minimized {
        show_settings(app);
        return;
    }

    let _ = window.set_skip_taskbar(true);
    let _ = window.hide();
}

fn create_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Emitter;

    let settings = MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)?;
    let status_bar = MenuItem::with_id(app, "statusBar", "显示/隐藏状态栏", true, None::<&str>)?;
    let inventory = MenuItem::with_id(app, "inventory", "显示/隐藏物品栏", true, None::<&str>)?;
    let crosshair = MenuItem::with_id(app, "crosshair", "显示/隐藏准星", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 CraftSharp", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&settings, &status_bar, &inventory, &crosshair, &separator, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("CraftSharp")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref().to_string();
            if id == "quit" {
                app.exit(0);
                return;
            }
            if id == "settings" {
                show_settings(app);
                return;
            }
            let _ = app.emit("tray-action", id);
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_settings(tray.app_handle());
            }
        });

    if let Some(icon) = appicon::tray_icon(app).or_else(|| app.default_window_icon().cloned()) {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// 隐藏窗口默认会被 WebView2 降频，设置面板和 HUD 控制页要等首次显示才补渲染。
/// 启动时关掉后台降频与遮挡判定，让隐藏页在启动阶段就完成加载。
#[cfg(windows)]
fn keep_hidden_webviews_active() {
    const FLAGS: &str = "--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion";
    let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
    if existing.contains("disable-background-timer-throttling") {
        return;
    }
    let merged = if existing.is_empty() {
        FLAGS.to_string()
    } else {
        format!("{existing} {FLAGS}")
    };
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", merged);
}

fn main() {
    #[cfg(windows)]
    keep_hidden_webviews_active();

    appicon::run_helper_if_requested();

    // 第二个实例只负责唤醒已有实例打开设置，不再初始化任何窗口
    if !singleinstance::acquire() {
        return;
    }

    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;

            create_tray(app.handle())?;
            singleinstance::watch(app.handle().clone());

            let slots_path = app.path().app_config_dir().unwrap_or_default().join("slots.json");
            slots::init(app.handle(), slots_path);

            // 原生状态栏先于 WebView 建好，启动就能按上次的参数出画面
            hud::init(app.handle());
            hud::inventory::init(app.handle());
            hud::cache::restore(app.handle());
            slots::on_changed(hud::inventory::slots_changed);

            // 配置里的窗口全部延迟到这里创建，顺序即初始化顺序
            for config in app.config().app.windows.iter() {
                tauri::WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
            }

            appicon::startup(app.handle());
            install_drag_hover(app.handle());
            // HUD、快捷栏、宿主窗口直接显隐；其余窗口保留系统过渡动画
            for window in app.webview_windows().values() {
                if let Ok(hwnd) = window.hwnd() {
                    let instant = matches!(window.label(), "main" | "hud" | "entity-view");
                    if instant {
                        platform::disable_transitions(hwnd.0 as isize);
                    } else {
                        platform::enable_transitions(hwnd.0 as isize);
                    }
                }
            }
            dragdrop::install_all(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            slot_icon,
            open_path,
            reveal_path,
            run_path_as_admin,
            path_exists,
            copy_to_clipboard,
            read_clipboard_paths,
            rename_path,
            register_hotkeys,
            system_metrics,
            set_hit_mask,
            drag_window,
            toggle_desktop_icons,
            hud_apply,
            hud_visible,
            hud_cache_write,
            inventory_apply,
            inventory_visible,
            crosshair_apply,
            bossbar_apply,
            tooltip_show,
            tooltip_hide,
            set_drop_zones,
            begin_file_drag,
            slots_snapshot,
            slots_import_legacy,
            slots_register_scope,
            slots_set,
            slots_clear,
            slots_swap,
            slots_move,
            slots_clear_by_path,
            slots_replace_path,
            read_skin_data_url,
            skins::list_skins,
            skins::import_skin,
            skins::rename_skin,
            skins::remove_skin,
            entity_host_frame,
            set_app_icon,
            set_autostart,
            install_caption_hook
        ])
        .run(tauri::generate_context!())
        .expect("error while running CraftSharp");
}
