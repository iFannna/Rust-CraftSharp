//! 贴图解码与合成。像素统一为预乘 alpha 的 0xAARRGGBB，
//! 写进 32 位 DIB 时小端字节序正好是 BGRA。

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

pub struct Sprite {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u32>,
}

thread_local! {
    static CACHE: RefCell<HashMap<String, Rc<Sprite>>> = RefCell::new(HashMap::new());
}

fn premultiply(rgba: &[u8]) -> Vec<u32> {
    let mut out = Vec::with_capacity(rgba.len() / 4);
    for pixel in rgba.chunks_exact(4) {
        let a = pixel[3] as u32;
        let r = pixel[0] as u32 * a / 255;
        let g = pixel[1] as u32 * a / 255;
        let b = pixel[2] as u32 * a / 255;
        out.push((a << 24) | (r << 16) | (g << 8) | b);
    }
    out
}

/// 按名字取贴图，名字见 `sprites::bytes`。
pub fn load(name: &str) -> Option<Rc<Sprite>> {
    CACHE.with(|cache| {
        if let Some(sprite) = cache.borrow().get(name) {
            return Some(sprite.clone());
        }
        let bytes = crate::hud::sprites::bytes(name)?;
        let image = image::load_from_memory(bytes).ok()?.to_rgba8();
        let sprite = Rc::new(Sprite {
            width: image.width(),
            height: image.height(),
            pixels: premultiply(image.as_raw()),
        });
        cache.borrow_mut().insert(name.to_string(), sprite.clone());
        Some(sprite)
    })
}

/// 文件图标按目标尺寸预缩放，平滑与像素两种采样各自缓存。
pub fn load_scaled(bytes: &[u8], width: u32, height: u32, smooth: bool) -> Option<Rc<Sprite>> {
    let image = image::load_from_memory(bytes).ok()?.to_rgba8();
    let filter = if smooth {
        image::imageops::FilterType::Lanczos3
    } else {
        image::imageops::FilterType::Nearest
    };
    let resized = image::imageops::resize(&image, width.max(1), height.max(1), filter);
    Some(Rc::new(Sprite {
        width: resized.width(),
        height: resized.height(),
        pixels: premultiply(resized.as_raw()),
    }))
}

impl Sprite {
    /// 像素缩放，占位图按 Nearest 另存一份避免二次采样。
    pub fn resized(&self, width: u32, height: u32, smooth: bool) -> Sprite {
        let mut out = Sprite {
            width: width.max(1),
            height: height.max(1),
            pixels: vec![0; (width.max(1) * height.max(1)) as usize],
        };
        if self.width == 0 || self.height == 0 {
            return out;
        }
        for y in 0..out.height {
            let sy = (y as u64 * self.height as u64 / out.height as u64) as u32;
            let sy = sy.min(self.height - 1);
            for x in 0..out.width {
                let sx = (x as u64 * self.width as u64 / out.width as u64) as u32;
                let sx = sx.min(self.width - 1);
                let color = self.pixels[(sy * self.width + sx) as usize];
                if smooth || color != 0 {
                    out.pixels[(y * out.width + x) as usize] = color;
                }
            }
        }
        out
    }
}

pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u32>,
}

impl Frame {
    pub fn new(width: u32, height: u32) -> Self {
        Frame {
            width: width.max(1),
            height: height.max(1),
            pixels: vec![0; (width.max(1) * height.max(1)) as usize],
        }
    }

    pub fn clear(&mut self) {
        self.pixels.fill(0);
    }

    /// 源-over 合成，坐标四边取整，和 Canvas 的 drawImage 行为一致。
    pub fn draw(&mut self, sprite: &Sprite, x: f32, y: f32, width: f32, height: f32) {
        let left = x.round() as i32;
        let top = y.round() as i32;
        let right = (x + width).round() as i32;
        let bottom = (y + height).round() as i32;
        let draw_width = (right - left).max(1);
        let draw_height = (bottom - top).max(1);
        if sprite.width == 0 || sprite.height == 0 {
            return;
        }

        for row in 0..draw_height {
            let dy = top + row;
            if dy < 0 || dy >= self.height as i32 {
                continue;
            }
            let sy = (row as u32 * sprite.height / draw_height as u32).min(sprite.height - 1);
            for col in 0..draw_width {
                let dx = left + col;
                if dx < 0 || dx >= self.width as i32 {
                    continue;
                }
                let sx = (col as u32 * sprite.width / draw_width as u32).min(sprite.width - 1);
                let color = sprite.pixels[(sy * sprite.width + sx) as usize];
                if color == 0 {
                    continue;
                }
                blend(&mut self.pixels[(dy as u32 * self.width + dx as u32) as usize], color);
            }
        }
    }

    /// 水平翻转绘制，右副手槽用。
    pub fn draw_mirrored(&mut self, sprite: &Sprite, x: f32, y: f32, width: f32, height: f32) {
        let left = x.round() as i32;
        let top = y.round() as i32;
        let right = (x + width).round() as i32;
        let bottom = (y + height).round() as i32;
        let draw_width = (right - left).max(1);
        let draw_height = (bottom - top).max(1);
        if sprite.width == 0 || sprite.height == 0 {
            return;
        }

        for row in 0..draw_height {
            let dy = top + row;
            if dy < 0 || dy >= self.height as i32 {
                continue;
            }
            let sy = (row as u32 * sprite.height / draw_height as u32).min(sprite.height - 1);
            for col in 0..draw_width {
                let dx = left + col;
                if dx < 0 || dx >= self.width as i32 {
                    continue;
                }
                let mirrored = draw_width as u32 - 1 - col as u32;
                let sx = (mirrored * sprite.width / draw_width as u32).min(sprite.width - 1);
                let color = sprite.pixels[(sy * sprite.width + sx) as usize];
                if color == 0 {
                    continue;
                }
                blend(&mut self.pixels[(dy as u32 * self.width + dx as u32) as usize], color);
            }
        }
    }

    /// 按不透明度绘制，用于剪切态格子。
    pub fn draw_alpha(&mut self, sprite: &Sprite, x: f32, y: f32, width: f32, height: f32, alpha: u32) {
        let left = x.round() as i32;
        let top = y.round() as i32;
        let right = (x + width).round() as i32;
        let bottom = (y + height).round() as i32;
        let draw_width = (right - left).max(1);
        let draw_height = (bottom - top).max(1);
        if sprite.width == 0 || sprite.height == 0 {
            return;
        }

        for row in 0..draw_height {
            let dy = top + row;
            if dy < 0 || dy >= self.height as i32 {
                continue;
            }
            let sy = (row as u32 * sprite.height / draw_height as u32).min(sprite.height - 1);
            for col in 0..draw_width {
                let dx = left + col;
                if dx < 0 || dx >= self.width as i32 {
                    continue;
                }
                let sx = (col as u32 * sprite.width / draw_width as u32).min(sprite.width - 1);
                let color = sprite.pixels[(sy * sprite.width + sx) as usize];
                if color == 0 {
                    continue;
                }
                let a = color >> 24;
                let scaled = (a * alpha / 255) << 24
                    | ((color >> 16 & 0xff) * alpha / 255) << 16
                    | ((color >> 8 & 0xff) * alpha / 255) << 8
                    | ((color & 0xff) * alpha / 255);
                blend(&mut self.pixels[(dy as u32 * self.width + dx as u32) as usize], scaled);
            }
        }
    }

    /// 等比缩放后居中绘制，等价于 WPF 的 Uniform。
    pub fn draw_uniform(&mut self, sprite: &Sprite, x: f32, y: f32, box_width: f32, box_height: f32) {
        if sprite.width == 0 || sprite.height == 0 {
            return;
        }
        let ratio = (box_width / sprite.width as f32).min(box_height / sprite.height as f32);
        let width = sprite.width as f32 * ratio;
        let height = sprite.height as f32 * ratio;
        self.draw(sprite, x + (box_width - width) / 2.0, y + (box_height - height) / 2.0, width, height);
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
