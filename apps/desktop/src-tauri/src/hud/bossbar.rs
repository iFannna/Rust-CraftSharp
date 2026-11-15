//! BOSS 血条：原生分层窗口，贴主屏顶部水平居中，纯展示。

use std::cell::RefCell;
use std::rc::Rc;

use serde::Deserialize;

use crate::hud::config::Metrics;
use crate::hud::sprite::{self, Frame, Sprite};
use crate::hud::text;
use crate::hud::win32 as w;
use crate::hud::win32::Dib;

const BAR_WIDTH: f32 = 182.0;
const BAR_HEIGHT: f32 = 5.0;
const NAME_FONT: f32 = 8.0;
const NAME_MARGIN_TOP: f32 = 3.0;
const NAME_MARGIN_BOTTOM: f32 = 1.0;
const NAME_TEXT_TOP: f32 = 0.1;
const NAME_LINE: f32 = 16.0 / 3.0;
const ITEM_GAP: f32 = 4.0;
const CHAR_SPACING: f32 = 1.0;
const SHADOW_DEPTH: f32 = 0.53;

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BossBarCfg {
    pub id: String,
    pub name: String,
    pub color: String,
    pub notch: Option<String>,
    pub enabled: bool,
    pub data_mapping: bool,
    pub mapping: String,
    pub custom: bool,
    pub value: f32,
}

struct BossBarWindow {
    hwnd: w::Hwnd,
    bars: Vec<BossBarCfg>,
    metrics: Metrics,
    frame: Option<Frame>,
    dib: Option<Dib>,
    shown: bool,
}

thread_local! {
    static WINDOW: RefCell<Option<BossBarWindow>> = const { RefCell::new(None) };
}

fn with_window<T>(f: impl FnOnce(&mut BossBarWindow) -> T) -> Option<T> {
    WINDOW.with(|cell| {
        let mut slot = cell.borrow_mut();
        let window = slot.get_or_insert_with(|| {
            let hwnd = w::create_named_window(
                "CraftSharpBossBar",
                "CraftSharp Boss Bar",
                wndproc,
                w::WS_EX_TRANSPARENT,
            );
            // BOSS 条和状态栏一样属于桌面层
            w::set_desktop_style(hwnd);
            w::set_desktop_owner(hwnd);
            w::park_desktop(hwnd);
            BossBarWindow {
                hwnd,
                bars: Vec::new(),
                metrics: Metrics::default(),
                frame: None,
                dib: None,
                shown: false,
            }
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

pub fn apply(bars: Vec<BossBarCfg>) {
    with_window(|window| {
        window.bars = bars.into_iter().filter(|bar| bar.enabled).collect();
        render(window);
    });
}

/// 前台回到应用时重新置底。
pub fn repark_desktop() {
    WINDOW.with(|cell| {
        if let Some(window) = cell.borrow_mut().as_mut() {
            if window.shown {
                w::park_desktop(window.hwnd);
            }
        }
    });
}

pub fn set_metrics(metrics: Metrics) {
    // 指标每秒都到，没有窗口或没有血条时不重绘
    WINDOW.with(|cell| {
        let mut slot = cell.borrow_mut();
        let Some(window) = slot.as_mut() else { return };
        window.metrics = metrics;
        if !window.bars.is_empty() {
            render(window);
        }
    });
}

fn percent(window: &BossBarWindow, bar: &BossBarCfg) -> f32 {
    if bar.custom {
        return (bar.value / 100.0).clamp(0.0, 1.0);
    }
    if bar.data_mapping {
        let value = match bar.mapping.as_str() {
            "memory" => window.metrics.memory,
            "cpu" => window.metrics.cpu,
            "gpu" => window.metrics.gpu,
            _ => window.metrics.battery,
        };
        return (value as f32).clamp(0.0, 1.0);
    }
    1.0
}

fn texture_pair(color: &str, notch: &Option<String>) -> (Option<Rc<Sprite>>, Option<Rc<Sprite>>) {
    let color = match color {
        "green" | "pink" | "purple" | "red" | "white" | "yellow" | "blue" => color,
        _ => "blue",
    };
    let background = sprite::load(&format!("gui/sprites/hud/boss_bar/{color}_background.png"));
    let progress = sprite::load(&format!("gui/sprites/hud/boss_bar/{color}_progress.png"));

    match notch.as_deref() {
        Some(name @ ("notched_6" | "notched_10" | "notched_12" | "notched_20")) => (
            sprite::load(&format!("gui/sprites/hud/boss_bar/{name}_background.png")).or(background),
            sprite::load(&format!("gui/sprites/hud/boss_bar/{name}_progress.png")).or(progress),
        ),
        _ => (background, progress),
    }
}

fn render(window: &mut BossBarWindow) {
    let dpi = w::dpi_of(window.hwnd).max(1.0);
    let monitor = w::primary_rect();
    let logical_width = (monitor.right - monitor.left) as f32 / dpi;
    let scale = (logical_width / 2560.0 * 6.0).max(1.0);
    let unit = scale * dpi;

    if window.bars.is_empty() {
        hide(window);
        return;
    }

    let pitch = (BAR_HEIGHT + ITEM_GAP + NAME_MARGIN_TOP + NAME_MARGIN_BOTTOM + NAME_LINE) * unit;
    let bar_height = BAR_HEIGHT * unit;
    let bar_width = BAR_WIDTH * unit;
    let first_top = (NAME_MARGIN_TOP + NAME_LINE + NAME_MARGIN_BOTTOM) * unit;
    let count = window.bars.len() as f32;
    let height = first_top + (count - 1.0) * pitch + bar_height;
    let width = bar_width;

    if window
        .frame
        .as_ref()
        .map(|frame| frame.width != width.ceil() as u32 || frame.height != height.ceil() as u32)
        .unwrap_or(true)
    {
        window.frame = Some(Frame::new(width.ceil() as u32, height.ceil() as u32));
    }
    if window
        .dib
        .as_ref()
        .map(|dib| dib.width != width.ceil() as u32 || dib.height != height.ceil() as u32)
        .unwrap_or(true)
    {
        window.dib = Dib::new(width.ceil() as u32, height.ceil() as u32);
    }
    let bars = window.bars.clone();
    let percents: Vec<f32> = bars.iter().map(|bar| percent(window, bar)).collect();

    let Some(frame) = &mut window.frame else { return };
    frame.clear();

    let font_px = NAME_FONT * unit;
    let spacing = CHAR_SPACING * unit;
    let shadow = (SHADOW_DEPTH * unit).round();

    for (index, bar) in bars.iter().enumerate() {
        let (background, progress) = texture_pair(&bar.color, &bar.notch);

        if !bar.name.is_empty() {
            let name_top = NAME_TEXT_TOP * unit + index as f32 * pitch;
            text::draw_centered(frame, width / 2.0, name_top, &bar.name, font_px, 0xffff_ffff, spacing, shadow, 255);
        }

        let bar_top = first_top + index as f32 * pitch;
        if let Some(background) = &background {
            frame.draw(background, 0.0, bar_top, bar_width, bar_height);
        }
        let filled = (bar_width * percents.get(index).copied().unwrap_or(1.0)).round();
        if filled <= 0.0 {
            continue;
        }
        if let Some(progress) = &progress {
            frame.draw_column_clipped(progress, 0.0, bar_top, bar_width, bar_height, filled);
        }
    }

    let x = monitor.left + ((monitor.right - monitor.left) as f32 - width) as i32 / 2;
    let y = monitor.top;
    if let (Some(frame), Some(dib)) = (&window.frame, &window.dib) {
        w::present(window.hwnd, frame, dib, x, y);
    }

    if !window.shown {
        window.shown = true;
        // SAFETY: 只显示，不抢焦点
        unsafe {
            w::ShowWindow(window.hwnd, w::SW_SHOWNOACTIVATE);
        }
        w::park_desktop(window.hwnd);
    }
}

fn hide(window: &mut BossBarWindow) {
    if window.shown {
        window.shown = false;
        // SAFETY: 只隐藏窗口
        unsafe {
            w::ShowWindow(window.hwnd, w::SW_HIDE);
        }
    }
}
