#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autostart;
mod desktop;
mod dragdrop;
mod hud;
mod icons;
mod metrics;
mod platform;
mod singleinstance;
mod windowdrag;

#[cfg(windows)]
mod hitmask;

#[cfg(windows)]
mod hotkeys;

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

/// 获取格子图标，返回 Data URL；路径无效返回 None。
#[tauri::command]
fn slot_icon(path: String, show_target_icon: bool) -> Option<String> {
    icons::slot_icon(&path, show_target_icon)
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
fn system_metrics() -> metrics::SystemMetrics {
    metrics::collect()
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

/// 前端下发窗口的拖放接受区域，坐标为客户区物理像素。
#[tauri::command]
fn set_drop_zones(label: String, zones: Vec<dragdrop::Zone>) {
    dragdrop::set_zones(&label, zones);
}

/// 把格子文件拖出窗口，交给系统拖放，返回文件是否被移走。
#[tauri::command]
fn begin_file_drag(path: String, size: Option<u32>) -> bool {
    dragdrop::begin_file_drag(path, size.unwrap_or(32))
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
            let _ = app.emit("tray-action", id);
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = tray.app_handle().emit("tray-action", "settings".to_string());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

fn main() {
    // 第二个实例只负责唤醒已有实例打开设置，不再初始化任何窗口
    if !singleinstance::acquire() {
        return;
    }

    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;

            create_tray(app.handle())?;
            singleinstance::watch(app.handle().clone());
            hud::init(app.handle());
            // MC 窗口与快捷栏一样直接显隐，不做系统过渡动画
            for window in app.webview_windows().values() {
                if let Ok(hwnd) = window.hwnd() {
                    platform::disable_transitions(hwnd.0 as isize);
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
            set_drop_zones,
            begin_file_drag,
            set_autostart
        ])
        .run(tauri::generate_context!())
        .expect("error while running CraftSharp");
}
