#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appdata;
mod appicon;
mod autostart;
mod desktop;
#[cfg(windows)]
mod dragdrop;
#[cfg(not(windows))]
mod dragdrop {
    use tauri::AppHandle;

    #[derive(Clone, serde::Deserialize)]
    pub struct Zone {
        pub id: String,
        pub left: f64,
        pub top: f64,
        pub width: f64,
        pub height: f64,
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DragResult {
        pub dropped: bool,
        pub window: Option<String>,
        pub zone: Option<String>,
        pub same_source: bool,
        pub handled: bool,
    }

    pub fn install(_: &AppHandle, _: &str, _: isize) {}

    pub fn install_all(_: &AppHandle) {}

    pub fn set_zones(_: &str, _: Vec<Zone>) {}

    pub fn set_hover_handler(_: impl Fn(&str, Option<&str>) + Send + Sync + 'static) {}

    pub fn begin_file_drag(_: String, _: u32, _: Option<(String, String)>) -> DragResult {
        DragResult {
            dropped: false,
            window: None,
            zone: None,
            same_source: false,
            handled: false,
        }
    }
}
mod hud;
mod icons;
mod metrics;
mod platform;
mod singleinstance;
mod skins;
mod slots;
mod wallpaper;
mod windowdrag;

#[cfg(windows)]
mod hitmask;

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
fn register_hotkeys(app: tauri::AppHandle, actions: Vec<String>) {
    #[cfg(windows)]
    hotkeys::register(&app, actions);
    #[cfg(not(windows))]
    let _ = (app, actions);
}

#[tauri::command]
fn hotkey_failures() -> Vec<String> {
    #[cfg(windows)]
    {
        hotkeys::failures()
    }
    #[cfg(not(windows))]
    {
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

/// 窗口页面挂载后同步当前应用图标，覆盖运行期新建的弹窗与预览窗口
#[tauri::command]
async fn sync_window_icon(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    appicon::apply_to_window(&app, &window)
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

/// 离屏窗口完成贴图加载并注册监听后调用，登记预览覆盖层并补发参数
#[tauri::command]
fn entity_view_ready() {
    #[cfg(windows)]
    hud::inventory::entity_ready();
}

#[tauri::command]
fn slots_replace_path(from: String, to: String, style: String, shared: bool) {
    slots::replace_path(&slots::Scope::new(style, shared), &from, &to);
}

/// 托盘鼠标抬起事件，坐标是屏幕物理像素，供前端在光标处弹菜单。
#[derive(Clone, serde::Serialize)]
struct TrayPointer {
    button: &'static str,
    x: f64,
    y: f64,
}

/// 菜单动态文案需要的实时状态。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayState {
    status_bar: bool,
    inventory: bool,
    desktop_icons: bool,
    double_click_ms: u32,
}

#[tauri::command]
fn tray_state() -> TrayState {
    TrayState {
        status_bar: hud::is_visible(),
        inventory: hud::inventory::is_visible(),
        desktop_icons: desktop::is_visible(),
        double_click_ms: double_click_ms(),
    }
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 拉取壁纸列表，网络请求放到阻塞线程
#[tauri::command]
async fn wallpaper_list(page: u32, kind: String, sort: String) -> Result<wallpaper::Page, String> {
    tauri::async_runtime::spawn_blocking(move || wallpaper::list(page, &kind, &sort))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn wallpaper_monitors() -> Vec<wallpaper::MonitorInfo> {
    tauri::async_runtime::spawn_blocking(wallpaper::monitors)
        .await
        .unwrap_or_default()
}

/// 应用整套壁纸布局：同步、按屏独立或跨屏拼接
#[tauri::command]
async fn wallpaper_apply_layout(
    app: tauri::AppHandle,
    plan: serde_json::Value,
) -> Result<wallpaper::ApplyResult, String> {
    let plan: crate::wallpaper::layout::Plan =
        serde_json::from_value(plan).map_err(|error| format!("壁纸参数无效：{error}"))?;
    tauri::async_runtime::spawn_blocking(move || wallpaper::apply_plan(&app, plan))
        .await
        .map_err(|error| error.to_string())?
}

/// 另存为对话框必须由主线程打开，异步命令里等待结果
#[tauri::command]
async fn wallpaper_pick_path(window: tauri::Window, title: String) -> Option<String> {
    use tauri::Manager;

    #[cfg(windows)]
    let owner = window.hwnd().ok().map(|handle| handle.0 as isize).unwrap_or(0);
    #[cfg(not(windows))]
    let owner = 0;
    let app = window.app_handle().clone();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.try_send(wallpaper::pick(&title, owner));
    })
    .ok()?;
    receiver.recv().await.flatten()
}

#[tauri::command]
async fn wallpaper_export(id: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || wallpaper::export(&id, &path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn wallpaper_session() -> bool {
    wallpaper::session()
}

#[tauri::command]
fn wallpaper_storage(app: tauri::AppHandle) -> String {
    wallpaper::storage_path(&app)
}

/// 切换壁纸存储目录，复制期间不中断正在播放的动态壁纸
#[tauri::command]
async fn wallpaper_migrate_storage(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || wallpaper::migrate_storage(&app, &path))
        .await
        .map_err(|error| error.to_string())?
}

/// 文件夹选择器同样必须由主线程打开
#[tauri::command]
async fn wallpaper_pick_folder(window: tauri::Window, title: String) -> Option<String> {
    use tauri::Manager;

    #[cfg(windows)]
    let owner = window.hwnd().ok().map(|handle| handle.0 as isize).unwrap_or(0);
    #[cfg(not(windows))]
    let owner = 0;
    let app = window.app_handle().clone();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.try_send(wallpaper::pick_folder(&title, owner));
    })
    .ok()?;
    receiver.recv().await.flatten()
}

/// 恢复默认存储目录，同时把缓存迁回应用数据目录
#[tauri::command]
async fn wallpaper_reset_storage(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || wallpaper::reset_storage(&app))
        .await
        .map_err(|error| error.to_string())?
}

/// 在资源管理器中打开存储目录
#[tauri::command]
fn wallpaper_open_storage(app: tauri::AppHandle) -> Result<(), String> {
    wallpaper::open_storage(&app)
}

#[tauri::command]
fn wallpaper_watch_login(app: tauri::AppHandle) {
    wallpaper::watch_login(&app);
}

#[tauri::command]
fn wallpaper_logout(app: tauri::AppHandle) {
    wallpaper::logout(&app);
}

/// 调试页清除数据：删除应用文件、还原默认图标并移除开机自启
#[tauri::command]
async fn clear_app_data(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || appdata::clear(&app))
        .await
        .map_err(|error| error.to_string())?
}

/// 清除数据后重新加载配置驱动的窗口，设置面板本身就地刷新
#[tauri::command]
fn reload_app_windows(app: tauri::AppHandle) {
    use tauri::Manager;

    slots::reset();
    for label in ["hud", "entity-view", "entity-preview"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.reload();
        }
    }
}

#[cfg(windows)]
fn double_click_ms() -> u32 {
    #[link(name = "user32")]
    extern "system" {
        fn GetDoubleClickTime() -> u32;
    }
    // SAFETY: 只读取系统双击间隔
    unsafe { GetDoubleClickTime() }
}

#[cfg(not(windows))]
fn double_click_ms() -> u32 {
    500
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

fn create_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Emitter;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("CraftSharp")
        .on_tray_icon_event(|tray, event| {
            let TrayIconEvent::Click {
                button,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            else {
                return;
            };
            let button = match button {
                MouseButton::Left => "left",
                MouseButton::Right => "right",
                MouseButton::Middle => "middle",
            };
            let _ = tray.app_handle().emit(
                "tray-pointer",
                TrayPointer {
                    button,
                    x: position.x,
                    y: position.y,
                },
            );
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

/// 打包后关掉 WebView2 自带的右键菜单、开发者工具、浏览器快捷键与缩放
#[cfg(all(windows, not(debug_assertions)))]
fn harden_webviews(app: &tauri::AppHandle) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;

    for window in app.webview_windows().values() {
        let _ = window.with_webview(|webview| unsafe {
            let controller = webview.controller();
            let Ok(core) = controller.CoreWebView2() else {
                return;
            };
            let Ok(settings) = core.Settings() else {
                return;
            };
            let _ = settings.SetAreDefaultContextMenusEnabled(false);
            let _ = settings.SetAreDevToolsEnabled(false);
            let _ = settings.SetIsZoomControlEnabled(false);
            if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
            }
        });
    }
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
        .register_asynchronous_uri_scheme_protocol("wpimg", |context, request, responder| {
            let app = context.app_handle().clone();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || {
                responder.respond(wallpaper::image_response(&app, &path));
            });
        })
        .setup(|app| {
            use tauri::Manager;

            create_tray(app.handle())?;
            singleinstance::watch(app.handle().clone());

            let slots_path = app.path().app_config_dir().unwrap_or_default().join("slots.json");
            slots::init(app.handle(), slots_path);

            // 原生状态栏先于 WebView 建好，启动就能按上次的参数出画面
            hud::init(app.handle());
            #[cfg(windows)]
            hud::inventory::init(app.handle());
            hud::cache::restore(app.handle());
            #[cfg(windows)]
            slots::on_changed(hud::inventory::slots_changed);

            // 配置里的窗口全部延迟到这里创建，顺序即初始化顺序；
            // 3D 覆盖层与各类弹窗由页面按需创建
            for config in app.config().app.windows.iter() {
                tauri::WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
            }

            #[cfg(all(windows, not(debug_assertions)))]
            harden_webviews(app.handle());

            appicon::startup(app.handle());
            wallpaper::init(app.handle());
            install_drag_hover(app.handle());
            // HUD 控制页直接显隐；其余窗口保留系统过渡动画
            #[cfg(windows)]
            for window in app.webview_windows().values() {
                if let Ok(hwnd) = window.hwnd() {
                    let instant = window.label() == "hud";
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
            hotkey_failures,
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
            entity_view_ready,
            set_app_icon,
            sync_window_icon,
            set_autostart,
            tray_state,
            exit_app,
            clear_app_data,
            reload_app_windows,
            wallpaper_list,
            wallpaper_monitors,
            wallpaper_apply_layout,
            wallpaper_pick_path,
            wallpaper_export,
            wallpaper_session,
            wallpaper_storage,
            wallpaper_migrate_storage,
            wallpaper_pick_folder,
            wallpaper_reset_storage,
            wallpaper_open_storage,
            wallpaper_watch_login,
            wallpaper_logout,
            install_caption_hook
        ])
        .run(tauri::generate_context!())
        .expect("error while running CraftSharp");
}
