#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod icons;

/// 获取格子图标，返回 Data URL；路径无效返回 None。
#[tauri::command]
fn slot_icon(path: String, show_target_icon: bool) -> Option<String> {
    icons::slot_icon(&path, show_target_icon)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![slot_icon])
        .run(tauri::generate_context!())
        .expect("error while running CraftSharp");
}
