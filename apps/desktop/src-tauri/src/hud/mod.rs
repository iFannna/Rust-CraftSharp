//! 原生状态栏：分层窗口一次提交位图与窗口几何，尺寸变化不经过合成器。

mod config;
mod dragicon;
mod draw;
mod host;
#[cfg(windows)]
mod host_win32;
#[cfg(target_os = "linux")]
mod host_x11;
mod input;
#[cfg(windows)]
mod input_win32;
mod layout;
mod sprite;
mod embedded;
mod text;
#[cfg(windows)]
mod win32;
mod window;

pub mod bossbar;
pub mod cache;
pub mod crosshair;
#[cfg(windows)]
pub mod inventory;
#[cfg(windows)]
mod inventory_draw;
#[cfg(not(windows))]
pub mod inventory {
    use serde::Deserialize;
    use tauri::AppHandle;

    #[derive(Deserialize, Default)]
    pub struct InventoryCfg {}

    pub fn apply(_: InventoryCfg) {}

    pub fn init(_: &AppHandle) {}

    pub fn set_visible(_: bool) {}

    pub fn set_drop_hover(_: Option<&str>) {}

    pub fn entity_ready() {}

    pub fn is_visible() -> bool {
        false
    }
}
pub mod overlay;
pub mod tooltip;

pub use config::HudConfig;
pub use window::{
    apply, hidden_by_inventory, init, is_visible, set_drop_hover, set_hidden_by_inventory,
    set_visible,
};
