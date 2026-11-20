//! 原生状态栏：分层窗口一次提交位图与窗口几何，尺寸变化不经过合成器。

mod config;
mod dragicon;
mod draw;
mod host;
#[cfg(windows)]
mod host_win32;
mod input;
#[cfg(windows)]
mod input_win32;
mod layout;
mod sprite;
mod embedded;
mod text;
mod win32;
mod window;

pub mod bossbar;
pub mod cache;
pub mod crosshair;
pub mod inventory;
mod inventory_draw;
pub mod overlay;
pub mod tooltip;

pub use config::HudConfig;
pub use window::{
    apply, hidden_by_inventory, init, is_visible, set_drop_hover, set_hidden_by_inventory,
    set_visible,
};
