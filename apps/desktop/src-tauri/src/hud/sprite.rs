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

fn premultiplied(pixel: &[u8]) -> u32 {
    let a = pixel[3] as u32;
    // 贴图基本只有全透明与不透明两种，边缘才需要真的乘
    if a == 255 {
        return 0xff00_0000 | (pixel[0] as u32) << 16 | (pixel[1] as u32) << 8 | pixel[2] as u32;
    }
    if a == 0 {
        return 0;
    }
    let r = pixel[0] as u32 * a / 255;
    let g = pixel[1] as u32 * a / 255;
    let b = pixel[2] as u32 * a / 255;
    (a << 24) | (r << 16) | (g << 8) | b
}

fn premultiply(rgba: &[u8]) -> Vec<u32> {
    rgba.chunks_exact(4).map(premultiplied).collect()
}

/// 按名字取贴图，名字见 `embedded::bytes`。
pub fn load(name: &str) -> Option<Rc<Sprite>> {
    CACHE.with(|cache| {
        if let Some(sprite) = cache.borrow().get(name) {
            return Some(sprite.clone());
        }
        let bytes = crate::hud::embedded::bytes(name)?;
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

/// 用后台线程解码好的 RGBA 组装贴图，只做像素预乘。
pub fn from_rgba(width: u32, height: u32, rgba: &[u8]) -> Sprite {
    Sprite {
        width: width.max(1),
        height: height.max(1),
        pixels: premultiply(rgba),
    }
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

        // 同尺寸时省掉逐像素的缩放换算，图标按原尺寸绘制时走这条路径
        if sprite.width == draw_width as u32 && sprite.height == draw_height as u32 {
            let x0 = left.max(0);
            let x1 = right.min(self.width as i32);
            let y0 = top.max(0);
            let y1 = bottom.min(self.height as i32);
            if x1 <= x0 || y1 <= y0 {
                return;
            }
            let stride = self.width as usize;
            let sprite_stride = sprite.width as usize;
            for dy in y0..y1 {
                let src_row = (dy - top) as usize * sprite_stride;
                let dst_row = dy as usize * stride;
                for dx in x0..x1 {
                    let color = sprite.pixels[src_row + (dx - left) as usize];
                    if color != 0 {
                        blend(&mut self.pixels[dst_row + dx as usize], color);
                    }
                }
            }
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

    /// 按整条宽度映射源坐标，只画到裁剪线为止。
    /// 不改变行跨距，进度不足时也不会错位。
    pub fn draw_column_clipped(
        &mut self,
        sprite: &Sprite,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        clip_right: f32,
    ) {
        let left = x.round() as i32;
        let top = y.round() as i32;
        let right = (x + width).round() as i32;
        let bottom = (y + height).round() as i32;
        let draw_width = (right - left).max(1);
        let draw_height = (bottom - top).max(1);
        let limit = clip_right.round() as i32;
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
                if dx >= limit {
                    break;
                }
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

    /// 用半透明色铺满矩形，悬停蒙版用。
    pub fn fill(&mut self, x: f32, y: f32, width: f32, height: f32, color: u32) {
        let left = x.round() as i32;
        let top = y.round() as i32;
        let right = (x + width).round() as i32;
        let bottom = (y + height).round() as i32;
        for dy in top..bottom {
            if dy < 0 || dy >= self.height as i32 {
                continue;
            }
            for dx in left..right {
                if dx < 0 || dx >= self.width as i32 {
                    continue;
                }
                blend(&mut self.pixels[(dy as u32 * self.width + dx as u32) as usize], color);
            }
        }
    }

    /// 把矩形清成完全透明，用于给覆盖层留洞。
    pub fn clear_rect(&mut self, x: f32, y: f32, width: f32, height: f32) {
        let left = x.round().max(0.0) as u32;
        let top = y.round().max(0.0) as u32;
        let right = ((x + width).round().max(0.0) as u32).min(self.width);
        let bottom = ((y + height).round().max(0.0) as u32).min(self.height);
        if right <= left || bottom <= top {
            return;
        }
        for dy in top..bottom {
            let start = (dy * self.width + left) as usize;
            self.pixels[start..start + (right - left) as usize].fill(0);
        }
    }

    /// 从源图指定区域取样，缩放绘制到目标区域，九宫格边角用。
    pub fn draw_source(
        &mut self,
        sprite: &Sprite,
        source_x: u32,
        source_y: u32,
        source_width: u32,
        source_height: u32,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
    ) {
        if source_width == 0 || source_height == 0 || sprite.width == 0 {
            return;
        }
        let left = x.round() as i32;
        let top = y.round() as i32;
        let right = (x + width).round() as i32;
        let bottom = (y + height).round() as i32;
        let draw_width = (right - left).max(1);
        let draw_height = (bottom - top).max(1);

        for row in 0..draw_height {
            let dy = top + row;
            if dy < 0 || dy >= self.height as i32 {
                continue;
            }
            let sy = source_y + (row as u32 * source_height / draw_height as u32).min(source_height - 1);
            if sy >= sprite.height {
                continue;
            }
            for col in 0..draw_width {
                let dx = left + col;
                if dx < 0 || dx >= self.width as i32 {
                    continue;
                }
                let sx = source_x + (col as u32 * source_width / draw_width as u32).min(source_width - 1);
                if sx >= sprite.width {
                    continue;
                }
                let color = sprite.pixels[(sy * sprite.width + sx) as usize];
                if color == 0 {
                    continue;
                }
                blend(&mut self.pixels[(dy as u32 * self.width + dx as u32) as usize], color);
            }
        }
    }
}

/// 九宫格贴图：四角不拉伸，边单向拉伸，中心双向拉伸。
pub fn draw_nine_slice(
    frame: &mut Frame,
    sprite: &Sprite,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    source_border: u32,
    target_border: u32,
) {
    let border = source_border;
    if border == 0 || sprite.width <= border * 2 || sprite.height <= border * 2 {
        return;
    }
    let target = target_border.max(1);
    if width < (target * 2) as f32 || height < (target * 2) as f32 {
        return;
    }

    let source_x = [0, border, sprite.width - border];
    let source_w = [border, sprite.width - border * 2, border];
    let target_x = [x, x + target as f32, x + width - target as f32];
    let target_w = [target as f32, width - (target * 2) as f32, target as f32];

    let source_y = [0, border, sprite.height - border];
    let source_h = [border, sprite.height - border * 2, border];
    let target_y = [y, y + target as f32, y + height - target as f32];
    let target_h = [target as f32, height - (target * 2) as f32, target as f32];

    for row in 0..3 {
        for column in 0..3 {
            frame.draw_source(
                sprite,
                source_x[column],
                source_y[row],
                source_w[column],
                source_h[row],
                target_x[column],
                target_y[row],
                target_w[column],
                target_h[row],
            );
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
