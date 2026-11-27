//! 系统占用指标：电池、内存、CPU、GPU，返回 0-1 的百分比给 HUD 数据映射。

use serde::Serialize;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod windows;

#[derive(Clone, Copy, Default, Serialize)]
pub struct SystemMetrics {
    pub battery: f64,
    pub memory: f64,
    pub cpu: f64,
    pub gpu: f64,
}

#[cfg(windows)]
pub fn collect() -> SystemMetrics {
    windows::collect()
}

#[cfg(target_os = "linux")]
pub fn collect() -> SystemMetrics {
    linux::collect()
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn collect() -> SystemMetrics {
    SystemMetrics::default()
}