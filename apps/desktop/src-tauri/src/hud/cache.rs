//! HUD 参数镜像：控制页把最终配置写到磁盘，启动时原生层先直接恢复一遍，
//! 不再等 WebView 加载完才出现状态栏与物品栏。

use std::fs;
use std::path::PathBuf;

use serde::Deserialize;
use tauri::Manager;

use super::bossbar::BossBarCfg;
use super::crosshair::CrosshairCfg;
use super::inventory::InventoryCfg;
use super::HudConfig;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    hud: HudConfig,
    inventory: InventoryCfg,
    #[serde(default)]
    crosshair: CrosshairCfg,
    #[serde(default)]
    boss_bars: Vec<BossBarCfg>,
}

fn path(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_default().join("hud-cache.json")
}

/// 先校验再写临时文件替换，避免退出时留下半截 JSON。
pub fn save(app: &tauri::AppHandle, payload: &str) -> Result<(), String> {
    serde_json::from_str::<Snapshot>(payload).map_err(|error| error.to_string())?;
    let path = path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, payload).map_err(|error| error.to_string())?;
    fs::rename(&temp, &path).map_err(|error| error.to_string())
}

pub fn restore(app: &tauri::AppHandle) {
    let Ok(raw) = fs::read_to_string(path(app)) else {
        return;
    };
    let Ok(snapshot) = serde_json::from_str::<Snapshot>(&raw) else {
        return;
    };

    super::apply(app, snapshot.hud);
    super::inventory::apply(snapshot.inventory);
    super::crosshair::apply(snapshot.crosshair);
    super::bossbar::apply(snapshot.boss_bars);
}
