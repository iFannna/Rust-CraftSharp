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

fn main() {
    tauri::Builder::default()
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
