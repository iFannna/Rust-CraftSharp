//! 文件名标签：Unifont 光栅化后画进同一张位图，带阴影和淡出。

use std::cell::RefCell;

use fontdue::{Font, FontSettings};

use crate::hud::layout::Layout;
use crate::hud::sprite::Frame;

const FONT_BYTES: &[u8] = include_bytes!("../../../../../assets/fonts/unifont-16.0.04.ttf");

thread_local! {
    static FONT: RefCell<Option<Font>> = const { RefCell::new(None) };
}

/// 把 #RRGGBB 变暗一半，作为阴影色。
pub fn darken(color: u32) -> u32 {
    let r = (color >> 16 & 0xff) / 2;
    let g = (color >> 8 & 0xff) / 2;
    let b = (color & 0xff) / 2;
    0xff00_0000 | (r << 16) | (g << 8) | b
}

pub fn parse_color(value: &str) -> u32 {
    let hex = value.trim_start_matches('#');
    let hex = if hex.len() == 8 { &hex[2..] } else { hex };
    u32::from_str_radix(hex, 16).map(|rgb| 0xff00_0000 | rgb).unwrap_or(0xffff_ffff)
}

/// 文件名自动配色：同名同色，哈希与原实现一致。
pub fn auto_color(name: &str) -> u32 {
    const PRESET: [u32; 9] = [0xfffcfcfc, 0xffa8a8a8, 0xfffcfc54, 0xff5454fc, 0xfffc54fc, 0xffa800a8, 0xfffc5454, 0xff54fcfc, 0xff00a800];
    if name.is_empty() {
        return PRESET[0];
    }
    let mut hash: u32 = 0x811c9dc5;
    for unit in name.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    PRESET[(hash % PRESET.len() as u32) as usize]
}

fn with_font<T>(f: impl FnOnce(&Font) -> T) -> Option<T> {
    FONT.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            *slot = Font::from_bytes(FONT_BYTES, FontSettings::default()).ok();
        }
        slot.as_ref().map(f)
    })
}

/// 在后台线程解析字体，避免第一次显示文件名时卡一下。
pub fn parse() -> Option<Font> {
    Font::from_bytes(FONT_BYTES, FontSettings::default()).ok()
}

/// 把后台解析好的字体交给窗口线程。
pub fn install(font: Font) {
    FONT.with(|cell| *cell.borrow_mut() = Some(font));
}

/// 在窗口底上方 50 倍缩放处绘制文件名，按快捷栏与经验条同宽的核心容器居中。
pub fn draw_label(frame: &mut Frame, layout: &Layout, text: &str, color: u32, alpha: u8) {
    let px = 8.0 * layout.scale;
    let Some(glyphs) = with_font(|font| rasterize(font, text, px)) else {
        return;
    };
    if glyphs.is_empty() {
        return;
    }

    // 字形 x 已经是累计位移，按实际墨迹范围居中
    let left = glyphs.iter().map(|glyph| glyph.x).fold(f32::MAX, f32::min);
    let right = glyphs.iter().map(|glyph| glyph.x + glyph.width as f32).fold(f32::MIN, f32::max);
    let min_top = glyphs.iter().map(|glyph| glyph.top).fold(f32::MAX, f32::min);
    let max_bottom = glyphs.iter().map(|glyph| glyph.top + glyph.height as f32).fold(f32::MIN, f32::max);
    // 布局已按标签高度在顶部补了透明带，这里固定 50 即可
    let bottom = layout.height - 50.0 * layout.scale;
    let origin_x = layout.core_left + (layout.core_width - (right - left)) / 2.0 - left;
    let origin_y = bottom - (max_bottom - min_top);
    let shadow = (0.53 * layout.scale).round();
    let shadow_color = darken(color);

    for glyph in &glyphs {
        let x = origin_x + glyph.x;
        let y = origin_y + (glyph.top - min_top);
        blit(frame, &glyph.bitmap, glyph.width, glyph.height, x + shadow, y + shadow, shadow_color, alpha);
        blit(frame, &glyph.bitmap, glyph.width, glyph.height, x, y, color, alpha);
    }
}

/// 按行顶对齐绘制单行文字，x 是行首，top 是行盒顶部。
pub fn draw_line(frame: &mut Frame, x: f32, top: f32, text: &str, px: f32, color: u32, alpha: u8) {
    let Some(glyphs) = with_font(|font| rasterize(font, text, px)) else { return };
    if glyphs.is_empty() {
        return;
    }
    // rasterize 的 top 已经按同一基线换算，逐行对齐不会随首字符高低跳动
    for glyph in &glyphs {
        let ink_top = top + glyph.top;
        blit(frame, &glyph.bitmap, glyph.width, glyph.height, x + glyph.x, ink_top, color, alpha);
    }
}

/// 逐字符测量整行宽度，BOSS 条名称居中用。
pub fn spaced_width(text: &str, px: f32, spacing: f32) -> f32 {
    with_font(|font| {
        let mut width = 0.0;
        let mut count = 0;
        for ch in text.chars() {
            let metrics = font.rasterize(ch, px).0;
            width += metrics.advance_width;
            count += 1;
        }
        if count > 1 {
            width + spacing * (count - 1) as f32
        } else {
            width
        }
    })
    .unwrap_or(0.0)
}

/// 逐字符居中绘制，字符之间加固定间距，带黑色阴影，BOSS 条名称用。
pub fn draw_centered(
    frame: &mut Frame,
    center_x: f32,
    top: f32,
    text: &str,
    px: f32,
    color: u32,
    spacing: f32,
    shadow: f32,
    alpha: u8,
) {
    let total = spaced_width(text, px, spacing);
    let start = center_x - total / 2.0;
    let Some(glyphs) = with_font(|font| {
        let ascent = font.horizontal_line_metrics(px).map(|metrics| metrics.ascent).unwrap_or(px * 0.8);
        let mut glyphs = Vec::new();
        let mut pen = start;
        for ch in text.chars() {
            let (metrics, bitmap) = font.rasterize(ch, px);
            if metrics.width > 0 && metrics.height > 0 {
                let ink_top = top + ascent - (metrics.height as f32 + metrics.ymin as f32);
                glyphs.push((pen + metrics.xmin as f32, ink_top, metrics.width, metrics.height, bitmap));
            }
            pen += metrics.advance_width + spacing;
        }
        glyphs
    }) else {
        return;
    };

    let shadow_color = 0xff00_0000;
    for (x, y, width, height, bitmap) in &glyphs {
        if shadow > 0.0 {
            blit(frame, bitmap, *width, *height, *x + shadow, *y + shadow, shadow_color, alpha);
        }
        blit(frame, bitmap, *width, *height, *x, *y, color, alpha);
    }
}

struct Glyph {
    bitmap: Vec<u8>,
    width: usize,
    height: usize,
    x: f32,
    top: f32,
}

fn rasterize(font: &Font, text: &str, px: f32) -> Vec<Glyph> {
    let mut out = Vec::new();
    let mut pen = 0.0;
    let mut baseline: Option<f32> = None;
    for ch in text.chars() {
        let (metrics, bitmap) = font.rasterize(ch, px);
        if baseline.is_none() {
            let metrics = font.horizontal_line_metrics(px);
            baseline = Some(metrics.map(|m| m.ascent).unwrap_or(px * 0.8));
        }
        let ascent = baseline.unwrap_or(px * 0.8);
        if metrics.width > 0 && metrics.height > 0 {
            out.push(Glyph {
                bitmap,
                width: metrics.width,
                height: metrics.height,
                x: pen + metrics.xmin as f32,
                top: ascent - (metrics.height as f32 + metrics.ymin as f32),
            });
        }
        pen += metrics.advance_width;
    }
    out
}

fn blit(frame: &mut Frame, bitmap: &[u8], width: usize, height: usize, x: f32, y: f32, color: u32, alpha: u8) {
    let left = x.round() as i32;
    let top = y.round() as i32;
    let cr = (color >> 16 & 0xff) as u32;
    let cg = (color >> 8 & 0xff) as u32;
    let cb = (color & 0xff) as u32;

    for row in 0..height {
        let dy = top + row as i32;
        if dy < 0 || dy >= frame.height as i32 {
            continue;
        }
        for col in 0..width {
            let dx = left + col as i32;
            if dx < 0 || dx >= frame.width as i32 {
                continue;
            }
            let coverage = bitmap[row * width + col] as u32 * alpha as u32 / 255;
            if coverage == 0 {
                continue;
            }
            let a = coverage;
            let color = (a << 24) | (cr * a / 255) << 16 | (cg * a / 255) << 8 | (cb * a / 255);
            let index = (dy as u32 * frame.width + dx as u32) as usize;
            blend(&mut frame.pixels[index], color);
        }
    }
}

fn blend(dst: &mut u32, src: u32) {
    let sa = src >> 24;
    if sa == 0 {
        return;
    }
    if sa == 255 {
        *dst = src;
        return;
    }
    let inv = 255 - sa;
    let dr = (*dst >> 16 & 0xff) * inv / 255;
    let dg = (*dst >> 8 & 0xff) * inv / 255;
    let db = (*dst & 0xff) * inv / 255;
    let out_a = sa + (*dst >> 24) * inv / 255;
    *dst = (out_a << 24)
        | (((src >> 16 & 0xff) + dr).min(255) << 16)
        | (((src >> 8 & 0xff) + dg).min(255) << 8)
        | ((src & 0xff) + db).min(255);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hud::layout::{compute, Offhand, Visibility};
    use crate::hud::sprite::Frame;

    fn ink_center(frame: &Frame) -> f32 {
        let mut left = frame.width;
        let mut right = 0;
        for y in 0..frame.height {
            for x in 0..frame.width {
                if frame.pixels[(y * frame.width + x) as usize] != 0 {
                    left = left.min(x);
                    right = right.max(x);
                }
            }
        }
        assert!(right >= left, "没有画出字形");
        (left + right + 1) as f32 / 2.0
    }

    #[test]
    fn label_centers_on_core_with_either_offhand() {
        let visible = Visibility {
            health: true,
            food: true,
            air: false,
            armor: false,
            absorbing: false,
            exp_bar: true,
            hotbar: true,
        };
        // 左、右单侧副手各测一次，标签都要与核心容器同轴
        for left_offhand in [true, false] {
            let layout = compute(
                6.0,
                Offhand { left: left_offhand, right: !left_offhand },
                visible,
                0,
            );
            let mut frame = Frame::new(layout.width.ceil() as u32, layout.height.ceil() as u32);
            draw_label(&mut frame, &layout, "example.txt", 0xffff_ffff, 255);
            let core = layout.core_left + layout.core_width / 2.0;
            // 阴影整体偏右下 3 像素，中心误差不超过 3
            assert!((ink_center(&frame) - core).abs() <= 3.0);
        }
    }
}
