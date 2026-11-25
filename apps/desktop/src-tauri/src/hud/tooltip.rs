//! Tooltip 原生窗口：九宫格底图、Unifont 换行文本、自动定位。

use std::cell::RefCell;

use serde::Deserialize;

use crate::hud::host::{Event, Host, Options};
use crate::hud::sprite::{self, Frame};
use crate::hud::text;

pub const BORDER_PIXELS: f32 = 3.0;
const PADDING_PIXELS: f32 = 3.0;
const FONT_PIXELS: f32 = 8.0;
const LINE_HEIGHT_PIXELS: f32 = 8.0;
const SHADOW_OFFSET_PIXELS: f32 = 0.53;
const MAX_WIDTH_PIXELS: f32 = 150.0;
const SIDE_OFFSET_PIXELS: f32 = 2.0;
const SCREEN_MARGIN_PIXELS: f32 = 5.0;

#[derive(Clone, Debug, Deserialize)]
pub struct TooltipLineCfg {
    pub text: String,
    pub color: String,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct TooltipAnchor {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct TooltipWork {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

/// 原生窗口直接使用的提示行，颜色已解析。
pub struct TooltipLine {
    pub text: String,
    pub color: u32,
}

pub fn parse_lines(lines: Vec<TooltipLineCfg>) -> Vec<TooltipLine> {
    lines
        .into_iter()
        .map(|line| TooltipLine { text: line.text, color: text::parse_color(&line.color) })
        .collect()
}

#[derive(Clone, Copy)]
pub struct RectF {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

struct TooltipWindow {
    host: Host,
    frame: Option<Frame>,
    shown: bool,
}

fn ignore(_: Event) {}

thread_local! {
    static WINDOW: RefCell<Option<TooltipWindow>> = const { RefCell::new(None) };
}

fn with_window<T>(f: impl FnOnce(&mut TooltipWindow) -> T) -> Option<T> {
    WINDOW.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            let options = Options { click_through: true, desktop: false, panel: false };
            let Some(host) =
                Host::create("CraftSharpTooltip", "CraftSharp Tooltip", options, ignore)
            else {
                return None;
            };
            *slot = Some(TooltipWindow { host, frame: None, shown: false });
        }
        Some(f(slot.as_mut()?))
    })
}

pub fn hide() {
    // 只收已经创建过的窗口，不在关闭时顺手创建
    WINDOW.with(|cell| {
        let mut slot = cell.borrow_mut();
        let Some(window) = slot.as_mut() else { return };
        if window.shown {
            window.shown = false;
            window.host.hide();
        }
    });
}

/// 显示提示框。`unit` 是物品栏一个 MC 像素对应的物理像素，
/// 锚点与工作区都是屏幕物理像素。
pub fn show(lines: &[TooltipLine], unit: f32, anchor: &RectF, work: &RectF) {
    if lines.is_empty() {
        hide();
        return;
    }
    let anchor = *anchor;
    let work = *work;

    let padding = PADDING_PIXELS * unit;
    let font_px = FONT_PIXELS * unit;
    let line_height = LINE_HEIGHT_PIXELS * unit;
    let max_width = MAX_WIDTH_PIXELS * unit;
    let content_max = (max_width - padding * 2.0).max(1.0);
    let shadow = (SHADOW_OFFSET_PIXELS * unit).round();

    let mut rows: Vec<(String, u32)> = Vec::new();
    for line in lines {
        for text in wrap(&line.text, font_px, content_max) {
            rows.push((text, line.color));
        }
    }

    let mut natural = 0.0f32;
    for (text, _) in &rows {
        natural = natural.max(text::spaced_width(text, font_px, 0.0));
    }

    let minimum = BORDER_PIXELS * unit * 2.0;
    let width = max_width.min(minimum.max(natural.ceil() + padding * 2.0)).ceil();
    let height = minimum.max(rows.len() as f32 * line_height + padding * 2.0).ceil();

    let x = {
        let mut x = anchor.right + SIDE_OFFSET_PIXELS * unit;
        if x + width > work.right {
            x = anchor.left - width - SIDE_OFFSET_PIXELS * unit;
        }
        x
    };
    let margin = SCREEN_MARGIN_PIXELS * unit;
    let y = {
        let mut y = anchor.top + (anchor.bottom - anchor.top - height) / 2.0;
        if y + height > work.bottom {
            y = work.bottom - height - margin;
        }
        if y < work.top {
            y = work.top + margin;
        }
        y
    };

    with_window(|window| {
        draw(window, &rows, width as u32, height as u32, padding, font_px, line_height, shadow, unit)
    });

    with_window(|window| {
        if let Some(frame) = &window.frame {
            window.host.present(frame, x.round() as i32, y.round() as i32);
        }
        if !window.shown {
            window.shown = true;
            window.host.show();
            window.host.raise();
        }
    });
}

fn wrap(text: &str, font_px: f32, max_width: f32) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }
    if text::spaced_width(text, font_px, 0.0) <= max_width {
        return vec![text.to_string()];
    }

    let mut rows = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if current.is_empty() {
            current.push(ch);
            continue;
        }
        let mut candidate = current.clone();
        candidate.push(ch);
        if text::spaced_width(&candidate, font_px, 0.0) <= max_width {
            current = candidate;
            continue;
        }

        // 从空格处回退，避免切断英文单词；没有断点就硬切
        let split = current.rfind(' ').filter(|index| *index > 0 && *index + 1 < current.len());
        match split {
            Some(index) => {
                rows.push(current[..index].to_string());
                let mut rest = current[index + 1..].to_string();
                rest.push(ch);
                current = rest;
            }
            None => {
                rows.push(current);
                current = ch.to_string();
            }
        }
    }
    if !current.is_empty() {
        rows.push(current);
    }
    rows
}

fn draw(
    window: &mut TooltipWindow,
    rows: &[(String, u32)],
    width: u32,
    height: u32,
    padding: f32,
    font_px: f32,
    line_height: f32,
    shadow: f32,
    unit: f32,
) {
    let resized = window
        .frame
        .as_ref()
        .map(|frame| frame.width != width || frame.height != height)
        .unwrap_or(true);
    if resized {
        window.frame = Some(Frame::new(width, height));
    }
    let Some(frame) = &mut window.frame else { return };
    frame.clear();

    if let Some(background) = sprite::load("gui/sprites/tooltip/background.png") {
        sprite::draw_nine_slice(
            frame,
            &background,
            0.0,
            0.0,
            width as f32,
            height as f32,
            BORDER_PIXELS as u32,
            (BORDER_PIXELS * unit).round().max(1.0) as u32,
        );
    }
    if let Some(border) = sprite::load("gui/sprites/tooltip/frame.png") {
        sprite::draw_nine_slice(
            frame,
            &border,
            0.0,
            0.0,
            width as f32,
            height as f32,
            BORDER_PIXELS as u32,
            (BORDER_PIXELS * unit).round().max(1.0) as u32,
        );
    }

    for (index, (text, color)) in rows.iter().enumerate() {
        let top = padding + index as f32 * line_height;
        if shadow > 0.0 {
            text::draw_line(frame, padding + shadow, top + shadow, text, font_px, text::darken(*color), 255);
        }
        text::draw_line(frame, padding, top, text, font_px, *color, 255);
    }
}
