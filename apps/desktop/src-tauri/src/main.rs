#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod icons;
mod platform;

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
    tauri::Builder::default()
        .setup(|app| {
            create_tray(app.handle())?;
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
            register_hotkeys
        ])
        .run(tauri::generate_context!())
        .expect("error while running CraftSharp");
}
