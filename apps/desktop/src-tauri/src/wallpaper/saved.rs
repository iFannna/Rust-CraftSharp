//! 动态壁纸布局持久化：应用退出后重启仍能恢复同一套壁纸。

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::store::Transform;

const FILE: &str = "wallpaper-dynamic.json";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub id: String,
    #[serde(default)]
    pub device: Option<String>,
    #[serde(default)]
    pub transform: Option<Transform>,
    #[serde(default)]
    pub span: bool,
}

fn path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_default()
        .join(FILE)
}

pub fn load(app: &AppHandle) -> Vec<Saved> {
    fs::read(path(app))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, items: &[Saved]) {
    let file = path(app);
    if items.is_empty() {
        let _ = fs::remove_file(file);
        return;
    }
    let Ok(bytes) = serde_json::to_vec(items) else {
        return;
    };
    let temp = file.with_extension("tmp");
    if fs::write(&temp, bytes).is_ok() {
        let _ = fs::rename(&temp, &file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_items_round_trip() {
        let items = vec![
            Saved {
                id: "wp_1".into(),
                device: Some(r"\\.\DISPLAY1".into()),
                transform: None,
                span: false,
            },
            Saved {
                id: "wp_2".into(),
                device: Some(r"\\.\DISPLAY2".into()),
                transform: Some(Transform {
                    zoom: 1.5,
                    offset_x: 0.2,
                    offset_y: -0.1,
                }),
                span: true,
            },
        ];
        let bytes = serde_json::to_vec(&items).unwrap();
        let restored: Vec<Saved> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].device.as_deref(), Some(r"\\.\DISPLAY1"));
        assert_eq!(restored[1].transform.unwrap().zoom, 1.5);
        assert!(restored[1].span);
    }
}
