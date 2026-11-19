//! 动态壁纸调度：多路实例、遮挡暂停、WorkerW 自愈与显示拓扑跟随。

mod renderer;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use windows::Win32::Foundation::RECT;
use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect};

use super::desktop;
use super::store::Transform;
use renderer::{Bounds, Handle, Spec};

struct Engine {
    specs: Vec<Spec>,
    handles: Vec<Handle>,
}

static ENGINE: OnceLock<Mutex<Engine>> = OnceLock::new();
static WATCHDOG: AtomicBool = AtomicBool::new(false);

fn engine() -> &'static Mutex<Engine> {
    ENGINE.get_or_init(|| {
        Mutex::new(Engine {
            specs: Vec::new(),
            handles: Vec::new(),
        })
    })
}

pub fn apply_monitors(targets: &[(String, PathBuf)]) -> Result<(), String> {
    let monitors = desktop::monitors();
    let mut specs = Vec::new();
    for (device, video) in targets {
        let monitor = monitors
            .iter()
            .find(|item| &item.device_path == device)
            .ok_or_else(|| format!("显示器不在线：{device}"))?;
        specs.push(Spec {
            video: video.clone(),
            bounds: Bounds {
                left: monitor.left,
                top: monitor.top,
                right: monitor.right,
                bottom: monitor.bottom,
            },
            transform: None,
            device: Some(device.clone()),
        });
    }
    if specs.is_empty() {
        return Err("没有可播放的显示器".into());
    }
    restart(specs)
}

pub fn apply_span(video: &PathBuf, transform: Transform) -> Result<(), String> {
    let monitors = desktop::monitors();
    let bounds = virtual_bounds(&monitors).ok_or_else(|| "没有可用显示器".to_string())?;
    restart(vec![Spec {
        video: video.clone(),
        bounds,
        transform: Some(transform),
        device: None,
    }])
}

pub fn stop_all() {
    if let Ok(mut engine) = engine().lock() {
        stop_handles(&mut engine);
        engine.specs.clear();
    }
}

fn restart(specs: Vec<Spec>) -> Result<(), String> {
    let mut engine = engine().lock().map_err(|_| "壁纸状态不可用".to_string())?;
    stop_handles(&mut engine);
    engine.specs = specs;
    start_handles(&mut engine)?;
    drop(engine);
    ensure_watchdog();
    Ok(())
}

fn start_handles(engine: &mut Engine) -> Result<(), String> {
    for spec in engine.specs.clone() {
        match renderer::start(spec) {
            Ok(handle) => engine.handles.push(handle),
            Err(error) => {
                stop_handles(engine);
                return Err(error);
            }
        }
    }
    Ok(())
}

fn stop_handles(engine: &mut Engine) {
    for handle in engine.handles.drain(..) {
        handle.stop.store(true, Ordering::Relaxed);
        handle.paused.store(true, Ordering::Relaxed);
        let _ = handle.thread.join();
    }
}

fn ensure_watchdog() {
    if WATCHDOG.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("wallpaper-watch".into())
        .spawn(|| loop {
            std::thread::sleep(Duration::from_secs(1));
            let Ok(mut engine) = engine().lock() else {
                break;
            };
            if engine.specs.is_empty() {
                stop_handles(&mut engine);
                WATCHDOG.store(false, Ordering::SeqCst);
                break;
            }

            let monitors = desktop::monitors();
            let mut next = Vec::new();
            let mut changed = false;
            for spec in &engine.specs {
                let bounds = if let Some(device) = &spec.device {
                    match monitors.iter().find(|item| &item.device_path == device) {
                        Some(monitor) => Bounds {
                            left: monitor.left,
                            top: monitor.top,
                            right: monitor.right,
                            bottom: monitor.bottom,
                        },
                        None => {
                            changed = true;
                            continue;
                        }
                    }
                } else {
                    match virtual_bounds(&monitors) {
                        Some(bounds) => bounds,
                        None => {
                            changed = true;
                            continue;
                        }
                    }
                };
                if bounds != spec.bounds {
                    changed = true;
                }
                next.push(Spec {
                    bounds,
                    ..spec.clone()
                });
            }
            if next.len() != engine.specs.len() {
                changed = true;
            }
            engine.specs = next;

            let dead = engine.handles.iter().any(|handle| !handle.alive());
            if changed || dead || engine.handles.len() != engine.specs.len() {
                stop_handles(&mut engine);
                let _ = start_handles(&mut engine);
            }

            let cover = foreground_cover();
            for handle in &engine.handles {
                let paused = cover.is_some_and(|rect| covered(rect, handle.spec.bounds));
                handle.paused.store(paused, Ordering::Relaxed);
            }
        });
}

fn virtual_bounds(monitors: &[desktop::MonitorInfo]) -> Option<Bounds> {
    if monitors.is_empty() {
        return None;
    }
    Some(Bounds {
        left: monitors.iter().map(|m| m.left).min()?,
        top: monitors.iter().map(|m| m.top).min()?,
        right: monitors.iter().map(|m| m.right).max()?,
        bottom: monitors.iter().map(|m| m.bottom).max()?,
    })
}

fn foreground_cover() -> Option<RECT> {
    // SAFETY: 只查询前台窗口与矩形
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut class = [0u16; 256];
        let len = GetClassNameW(hwnd, &mut class);
        if len > 0 {
            let name = String::from_utf16_lossy(&class[..len as usize]);
            if matches!(name.as_str(), "Progman" | "WorkerW" | "SHELLDLL_DefView") {
                return None;
            }
        }
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).ok()?;
        Some(rect)
    }
}

fn covered(window: RECT, bounds: Bounds) -> bool {
    window.left <= bounds.left + 2
        && window.top <= bounds.top + 2
        && window.right >= bounds.right - 2
        && window.bottom >= bounds.bottom - 2
}
