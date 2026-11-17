//! 调试页「清除数据」：还原默认图标、移除开机自启并删除应用配置目录内容。
//! 只清理应用自身产生的文件，快捷栏与物品栏指向的外部文件保持不动。

use std::fs;
use std::path::Path;

use tauri::Manager;

use crate::{appicon, autostart};

fn clear_dir(dir: &Path, failures: &mut Vec<String>) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            failures.push(format!("{}：{error}", dir.display()));
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        if let Err(error) = result {
            failures.push(format!("{}：{error}", path.display()));
        }
    }
}

/// 返回未能清除的条目；配置目录整体不可读时也按失败项返回，由前端提示。
pub fn clear(app: &tauri::AppHandle) -> Result<(), String> {
    let mut failures = Vec::new();

    // 先还原程序文件与快捷方式图标，再删除保存的图标源文件
    if let Err(error) = appicon::apply(app, None) {
        failures.push(format!("应用图标：{error}"));
    }
    if let Err(error) = autostart::set(false) {
        failures.push(format!("开机自启：{error}"));
    }

    match app.path().app_config_dir() {
        Ok(dir) => clear_dir(&dir, &mut failures),
        Err(error) => failures.push(format!("配置目录：{error}")),
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("\n"))
    }
}
