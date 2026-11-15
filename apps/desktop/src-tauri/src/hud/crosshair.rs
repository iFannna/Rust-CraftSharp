//! 准星与攻击指示器：原生分层窗口，居中绘制，鼠标穿透。

use std::cell::RefCell;
use std::rc::Rc;

use serde::Deserialize;

use crate::hud::config::Metrics;
use crate::hud::sprite::{self, Frame, Sprite};
use crate::hud::win32 as w;
use crate::hud::win32::Dib;

/// 2560 逻辑像素宽下放大 6 倍
const SCALE_BASE_WIDTH: f32 = 2560.0;
const SCALE_MULTIPLIER: f32 = 6.0;
const ATTACK_SPACING: f32 = 1.0;

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CrosshairCfg {
    pub visible: bool,
    pub crosshair_visible: bool,
    pub top_most: bool,
    pub attack_visible: bool,
    pub attack_data_mapping: bool,
    pub attack_mapping: String,
    pub attack_custom: bool,
    pub attack_value: f32,
}

struct CrosshairWindow {
    hwnd: w::Hwnd,
    config: Option<CrosshairCfg>,
    metrics: Metrics,
    frame: Option<Frame>,
    dib: Option<Dib>,
    shown: bool,
    /// 窗口矩形，坐标全部换算到窗口客户区
    origin: (i32, i32),
}

thread_local! {
    static WINDOW: RefCell<Option<CrosshairWindow>> = const { RefCell::new(None) };
}

fn with_window<T>(f: impl FnOnce(&mut CrosshairWindow) -> T) -> Option<T> {
    WINDOW.with(|cell| {
        let mut slot = cell.borrow_mut();
        let window = slot.get_or_insert_with(|| CrosshairWindow {
            hwnd: w::create_named_window(
                "CraftSharpCrosshair",
                "CraftSharp Crosshair",
                wndproc,
                w::WS_EX_TRANSPARENT,
            ),
            config: None,
            metrics: Metrics::default(),
            frame: None,
            dib: None,
            shown: false,
            origin: (0, 0),
        });
        if window.hwnd == 0 {
            return None;
        }
        Some(f(window))
    })
}

unsafe extern "system" fn wndproc(hwnd: w::Hwnd, message: u32, wparam: usize, lparam: isize) -> isize {
    match message {
        w::WM_MOUSEACTIVATE => return 3,
        w::WM_ERASEBKGND => return 1,
        w::WM_PAINT => {
            w::validate(hwnd);
            return 0;
        }
        w::WM_NCHITTEST => return -1,
        _ => {}
    }
    w::DefWindowProcW(hwnd, message, wparam, lparam)
}

pub fn apply(config: CrosshairCfg) {
    with_window(|window| {
        window.config = Some(config);
        let topmost = window.config.as_ref().map(|config| config.top_most).unwrap_or(false);
        w::set_desktop_owner(window.hwnd);
        if topmost {
            w::raise_overlay(window.hwnd);
        } else {
            w::set_desktop_style(window.hwnd);
            w::park_desktop(window.hwnd);
        }
        render(window);
    });
}

/// 置顶时提到置顶层，桌面层时置底。
fn raise_layer(window: &CrosshairWindow) {
    if window.config.as_ref().map(|config| config.top_most).unwrap_or(false) {
        w::raise_overlay(window.hwnd);
    } else {
        w::park_desktop(window.hwnd);
    }
}

pub fn set_metrics(metrics: Metrics) {
    // 指标每秒都到，没有窗口或窗口隐藏时不重绘
    WINDOW.with(|cell| {
        let mut slot = cell.borrow_mut();
        let Some(window) = slot.as_mut() else { return };
        window.metrics = metrics;
        if window.config.as_ref().map(|config| config.visible).unwrap_or(false) {
            render(window);
        }
    });
}

fn percent(window: &CrosshairWindow) -> f32 {
    let Some(config) = &window.config else { return 1.0 };
    if config.attack_custom {
        return (config.attack_value / 100.0).clamp(0.0, 1.0);
    }
    if config.attack_data_mapping {
        let value = match config.attack_mapping.as_str() {
            "memory" => window.metrics.memory,
            "cpu" => window.metrics.cpu,
            "gpu" => window.metrics.gpu,
            _ => window.metrics.battery,
        };
        return (value as f32).clamp(0.0, 1.0);
    }
    1.0
}

struct Textures {
    crosshair: Option<Rc<Sprite>>,
    background: Option<Rc<Sprite>>,
    progress: Option<Rc<Sprite>>,
    full: Option<Rc<Sprite>>,
}

fn textures() -> Textures {
    Textures {
        crosshair: sprite::load("gui/sprites/hud/crosshair/crosshair.png"),
        background: sprite::load("gui/sprites/hud/crosshair/crosshair_attack_indicator_background.png"),
        progress: sprite::load("gui/sprites/hud/crosshair/crosshair_attack_indicator_progress.png"),
        full: sprite::load("gui/sprites/hud/crosshair/crosshair_attack_indicator_full.png"),
    }
}

fn render(window: &mut CrosshairWindow) {
    let Some(config) = window.config.clone() else { return };

    let monitor = w::primary_rect();
    let dpi = w::dpi_of(window.hwnd).max(1.0);
    let logical_width = (monitor.right - monitor.left) as f32 / dpi;
    let scale = (logical_width / SCALE_BASE_WIDTH * SCALE_MULTIPLIER).max(1.0);
    let unit = scale * dpi;

    let textures = textures();
    let Some(crosshair) = &textures.crosshair else {
        hide(window);
        return;
    };

    let crosshair_w = crosshair.width as f32 * unit;
    let crosshair_h = crosshair.height as f32 * unit;
    let center_x = (monitor.left + monitor.right) as f32 / 2.0;
    let center_y = (monitor.top + monitor.bottom) as f32 / 2.0;

    let crosshair_left = (center_x - crosshair_w / 2.0).round();
    let crosshair_top = (center_y - crosshair_h / 2.0).round();

    let (bar_width, bar_height, full_width, full_height) = match (&textures.background, &textures.full) {
        (Some(background), Some(full)) => (
            background.width as f32 * unit,
            background.height as f32 * unit,
            full.width as f32 * unit,
            full.height as f32 * unit,
        ),
        (Some(background), None) => {
            (background.width as f32 * unit, background.height as f32 * unit, 0.0, 0.0)
        }
        _ => (0.0, 0.0, 0.0, 0.0),
    };
    let box_width = bar_width.max(full_width);
    let box_left = center_x - box_width / 2.0;
    let box_top = center_y + crosshair_h / 2.0 + ATTACK_SPACING * unit;
    let show_attack = config.attack_visible && box_width > 0.0;

    let mut left = crosshair_left;
    let top = crosshair_top;
    let mut right = crosshair_left + crosshair_w;
    let mut bottom = crosshair_top + crosshair_h;
    if show_attack {
        left = left.min(box_left.round());
        right = right.max((box_left + box_width).round());
        bottom = bottom.max((box_top + bar_height.max(full_height)).round());
    }

    let width = (right - left).max(1.0) as u32;
    let height = (bottom - top).max(1.0) as u32;

    if window.frame.as_ref().map(|frame| frame.width != width || frame.height != height).unwrap_or(true) {
        window.frame = Some(Frame::new(width, height));
    }
    if window.dib.as_ref().map(|dib| dib.width != width || dib.height != height).unwrap_or(true) {
        window.dib = Dib::new(width, height);
    }
    let ratio = percent(window);
    let Some(frame) = &mut window.frame else { return };
    frame.clear();

    if config.crosshair_visible {
        frame.draw(crosshair, crosshair_left - left, crosshair_top - top, crosshair_w, crosshair_h);
    }

    if show_attack {
        if ratio >= 1.0 {
            if let Some(full) = &textures.full {
                frame.draw(
                    full,
                    box_left + (box_width - full_width) / 2.0 - left,
                    box_top - top,
                    full_width,
                    full_height,
                );
            }
        } else if let Some(background) = &textures.background {
            let bar_left = box_left + (box_width - bar_width) / 2.0;
            frame.draw(background, bar_left - left, box_top - top, bar_width, bar_height);
            if let Some(progress) = &textures.progress {
                let clip = bar_left + bar_width * ratio - left;
                frame.draw_column_clipped(progress, bar_left - left, box_top - top, bar_width, bar_height, clip);
            }
        }
    }

    window.origin = (left.round() as i32, top.round() as i32);
    if let (Some(frame), Some(dib)) = (&window.frame, &window.dib) {
        w::present(window.hwnd, frame, dib, window.origin.0, window.origin.1);
    }

    if config.visible {
        if !window.shown {
            window.shown = true;
            // SAFETY: 只显示，不抢焦点
            unsafe {
                w::ShowWindow(window.hwnd, w::SW_SHOWNOACTIVATE);
            }
            raise_layer(window);
        }
    } else {
        hide(window);
    }
}

fn hide(window: &mut CrosshairWindow) {
    if window.shown {
        window.shown = false;
        // SAFETY: 只隐藏窗口
        unsafe {
            w::ShowWindow(window.hwnd, w::SW_HIDE);
        }
    }
}
