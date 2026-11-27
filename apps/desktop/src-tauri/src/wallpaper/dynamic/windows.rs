//! Windows 动态壁纸调度：多路实例、遮挡暂停、WorkerW 自愈与显示拓扑跟随。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::AppHandle;
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect};

use super::super::{desktop, saved, store};
use super::super::store::Transform;
use super::renderer::{self, Bounds, Handle, Spec};

pub use super::super::saved::Saved;

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

pub fn apply_monitors(_app: &AppHandle, targets: &[(String, PathBuf)]) -> Result<(), String> {
    let monitors = desktop::monitors_native();
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
            span: None,
        });
    }
    if specs.is_empty() {
        return Err("没有可播放的显示器".into());
    }
    restart(specs)
}

pub fn apply_span(_app: &AppHandle, video: &PathBuf, transform: Transform) -> Result<(), String> {
    let monitors = desktop::monitors_native();
    let virtual_bounds = virtual_bounds(&monitors).ok_or_else(|| "没有可用显示器".to_string())?;
    let specs = monitors
        .iter()
        .map(|monitor| Spec {
            video: video.clone(),
            bounds: Bounds {
                left: monitor.left,
                top: monitor.top,
                right: monitor.right,
                bottom: monitor.bottom,
            },
            transform: Some(transform),
            device: Some(monitor.device_path.clone()),
            span: Some(virtual_bounds),
        })
        .collect();
    restart(specs)
}

pub fn stop_all() {
    if let Ok(mut engine) = engine().lock() {
        engine.specs.clear();
        let handles = std::mem::take(&mut engine.handles);
        stop_handles_vec(handles);
    }
}

/// 记录当前动态布局，供下次启动恢复
pub fn remember(app: &AppHandle, items: &[Saved]) {
    saved::save(app, items);
}

pub fn forget(app: &AppHandle) {
    saved::save(app, &[]);
}

/// 启动时恢复动态壁纸；布局暂不可用时短间隔重试
pub fn restore(app: &AppHandle) {
    let saved = saved::load(app);
    if saved.is_empty() {
        return;
    }
    let handle = app.clone();
    let _ = std::thread::Builder::new()
        .name("wallpaper-restore".into())
        .spawn(move || {
            for attempt in 0..20 {
                if attempt > 0 {
                    std::thread::sleep(Duration::from_millis(400));
                }
                let Some(specs) = specs_from(&handle, &saved) else {
                    continue;
                };
                if specs.is_empty() {
                    // 视频可能暂不可用，保留下次启动再试
                    return;
                }
                if restart(specs).is_ok() {
                    return;
                }
            }
        });
}

/// 返回 None 表示显示器尚未就绪，保留状态稍后重试
fn specs_from(app: &AppHandle, saved: &[Saved]) -> Option<Vec<Spec>> {
    let monitors = desktop::monitors_native();
    if monitors.is_empty() {
        return None;
    }
    let mut specs = Vec::new();
    for item in saved {
        let Some(video) = store::cached_video(app, &item.id) else {
            continue;
        };
        if let Some(device) = &item.device {
            if let Some(monitor) = monitors.iter().find(|m| &m.device_path == device) {
                specs.push(Spec {
                    video,
                    bounds: Bounds {
                        left: monitor.left,
                        top: monitor.top,
                        right: monitor.right,
                        bottom: monitor.bottom,
                    },
                    transform: if item.span { item.transform } else { None },
                    device: Some(device.clone()),
                    span: if item.span {
                        virtual_bounds(&monitors)
                    } else {
                        None
                    },
                });
            }
        }
    }
    Some(specs)
}

/// 只停掉指定显示器上的动态壁纸，其他屏幕保持播放
pub fn stop_devices(devices: &[String]) {
    if devices.is_empty() {
        return;
    }
    let Ok(mut engine) = engine().lock() else {
        return;
    };
    let mut removed = Vec::new();
    let mut kept = Vec::new();
    for handle in engine.handles.drain(..) {
        let matched = handle
            .spec
            .device
            .as_ref()
            .is_some_and(|device| devices.contains(device));
        if matched {
            removed.push(handle);
        } else {
            kept.push(handle);
        }
    }
    engine.specs.retain(|spec| {
        spec.device
            .as_ref()
            .map_or(true, |device| !devices.contains(device))
    });
    engine.handles = kept;
    stop_handles_vec(removed);
}

fn restart(specs: Vec<Spec>) -> Result<(), String> {
    let mut engine = engine().lock().map_err(|_| "壁纸状态不可用".to_string())?;
    let started = reconcile(&mut engine, specs)?;
    drop(engine);
    if started {
        ensure_watchdog();
    }
    Ok(())
}

/// 复用未变化的实例，新建其余实例并在新窗口内交叉淡化后停掉旧实例
fn reconcile(engine: &mut Engine, specs: Vec<Spec>) -> Result<bool, String> {
    let mut old = std::mem::take(&mut engine.handles);
    let mut kept = Vec::new();
    let mut fresh = Vec::new();
    let mut started = false;

    for spec in specs.iter().cloned() {
        let existing = old.iter().position(|handle| {
            handle.alive()
                && handle.spec.device == spec.device
                && handle.spec.bounds == spec.bounds
        });
        if let Some(index) = existing {
            let mut handle = old.remove(index);
            if !handle.spec.same(&spec) {
                if let Err(error) = renderer::switch(&handle, &spec) {
                    kept.push(handle);
                    stop_handles_vec(fresh);
                    let mut restored = kept;
                    restored.extend(old);
                    engine.handles = restored;
                    return Err(error);
                }
                handle.spec = spec;
            }
            kept.push(handle);
            continue;
        }
        match renderer::start(spec) {
            Ok(handle) => {
                fresh.push(handle);
                started = true;
            }
            Err(error) => {
                stop_handles_vec(fresh);
                let mut restored = kept;
                restored.extend(old);
                engine.handles = restored;
                return Err(error);
            }
        }
    }

    stop_handles_vec(old);

    engine.handles = kept;
    engine.handles.extend(fresh);
    engine.specs = specs;
    Ok(started || !engine.handles.is_empty())
}

fn stop_handles_vec(handles: Vec<Handle>) {
    for handle in handles {
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
                let handles = std::mem::take(&mut engine.handles);
                stop_handles_vec(handles);
                WATCHDOG.store(false, Ordering::SeqCst);
                break;
            }

            let monitors = desktop::monitors_native();
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
                let span = if spec.span.is_some() {
                    let span = virtual_bounds(&monitors);
                    if span != spec.span {
                        changed = true;
                    }
                    span
                } else {
                    None
                };
                next.push(Spec {
                    bounds,
                    span,
                    ..spec.clone()
                });
            }
            if next.len() != engine.specs.len() {
                changed = true;
            }
            engine.specs = next;

            let dead = engine.handles.iter().any(|handle| !handle.alive());
            if changed || dead || engine.handles.len() != engine.specs.len() {
                let specs = engine.specs.clone();
                let _ = reconcile(&mut engine, specs);
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
