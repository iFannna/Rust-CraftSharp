//! 原生状态栏：分层窗口一次提交位图与窗口几何，尺寸变化不经过合成器。

mod config;
mod dragicon;
mod draw;
mod input;
mod layout;
mod sprite;
mod sprites;
mod text;
mod win32;
mod window;

pub use config::HudConfig;
pub use window::{apply, init, set_drop_hover, set_visible};
