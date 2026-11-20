//! 状态栏平台宿主：窗口、呈现、几何与计时。
//! 业务层只处理 Event，不接触平台句柄。

pub use imp::{attach_app, ticks, Host};

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Copy, Default)]
pub struct Area {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Clone, Copy)]
pub enum Event {
    Move(f32, f32),
    Leave,
    /// 落在顶部透明带，只清悬停，不结束鼠标跟踪
    HoverClear,
    Down(f32, f32),
    Up(f32, f32),
    Menu(f32, f32),
    Wheel(i16),
    KeyDown(u32),
    KeyUp(u32),
    CaptureLost,
    Timer(usize),
    DpiChanged,
}

#[derive(Clone, Copy, Default)]
pub struct Options {
    /// 整个窗口鼠标穿透，不接收点击
    pub click_through: bool,
    /// 属于桌面层：所有者设为 Progman，停在普通窗口之下
    pub desktop: bool,
}

#[cfg(windows)]
mod imp {
    pub use crate::hud::host_win32::{attach_app, ticks, Host};
}

#[cfg(target_os = "linux")]
mod imp {
    pub use crate::hud::host_x11::{attach_app, ticks, Host};
}
