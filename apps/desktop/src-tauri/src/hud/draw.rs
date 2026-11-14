//! 状态栏绘制，和原 Canvas 渲染顺序保持一致。

use std::rc::Rc;

use crate::hud::config::{Element, HudConfig};
use crate::hud::layout::{self, Layout};
use crate::hud::sprite::{self, Frame, Sprite};

pub struct SlotIcon {
    pub sprite: Rc<Sprite>,
}

pub struct Overlay<'a> {
    pub hover_slot: i32,
    pub selected_slot: i32,
    pub dimmed_slot: i32,
    pub drag: Option<&'a SlotIcon>,
    pub drag_source: i32,
    pub drag_x: f32,
    pub drag_y: f32,
    /// 生命值变化前的数值，用于闪烁
    pub heart_flash: Option<f32>,
    /// 空气破裂的槽位区间 [from, to)
    pub air_burst: Option<(i32, i32)>,
}

impl Default for Overlay<'_> {
    fn default() -> Self {
        Overlay {
            hover_slot: -1,
            selected_slot: -1,
            dimmed_slot: -1,
            drag: None,
            drag_source: -1,
            drag_x: 0.0,
            drag_y: 0.0,
            heart_flash: None,
            air_burst: None,
        }
    }
}

struct RowSprites {
    background: Rc<Sprite>,
    full: Rc<Sprite>,
    half: Rc<Sprite>,
    background_flash: Rc<Sprite>,
    full_flash: Rc<Sprite>,
    half_flash: Rc<Sprite>,
}

fn sprite_or(name: &str, fallback: &str) -> Rc<Sprite> {
    sprite::load(name)
        .or_else(|| sprite::load(fallback))
        .unwrap_or_else(|| Rc::new(Sprite { width: 0, height: 0, pixels: Vec::new() }))
}

fn health_row(style: &str) -> RowSprites {
    let prefix = if style.is_empty() { String::new() } else { format!("{style}_") };
    let container = match style {
        "hardcore" | "vehicle" => format!("hud/heart/container_{style}.png"),
        _ => "hud/heart/container.png".to_string(),
    };
    let container_flash = if style == "hardcore" {
        "hud/heart/container_hardcore_blinking.png"
    } else {
        "hud/heart/container_blinking.png"
    };
    RowSprites {
        background: sprite_or(&container, "hud/heart/container.png"),
        full: sprite_or(&format!("hud/heart/{prefix}full.png"), "hud/heart/full.png"),
        half: sprite_or(&format!("hud/heart/{prefix}half.png"), "hud/heart/half.png"),
        background_flash: sprite_or(container_flash, "hud/heart/container_blinking.png"),
        full_flash: sprite_or(&format!("hud/heart/{prefix}full_blinking.png"), "hud/heart/full_blinking.png"),
        half_flash: sprite_or(&format!("hud/heart/{prefix}half_blinking.png"), "hud/heart/half_blinking.png"),
    }
}

fn food_row(style: &str) -> RowSprites {
    let suffix = if style == "hunger" { "_hunger" } else { "" };
    RowSprites {
        background: sprite_or(&format!("hud/food/food_empty{suffix}.png"), "hud/food/food_empty.png"),
        full: sprite_or(&format!("hud/food/food_full{suffix}.png"), "hud/food/food_full.png"),
        half: sprite_or(&format!("hud/food/food_half{suffix}.png"), "hud/food/food_half.png"),
        background_flash: sprite_or(&format!("hud/food/food_empty{suffix}.png"), "hud/food/food_empty.png"),
        full_flash: sprite_or(&format!("hud/food/food_full{suffix}.png"), "hud/food/food_full.png"),
        half_flash: sprite_or(&format!("hud/food/food_half{suffix}.png"), "hud/food/food_half.png"),
    }
}

fn absorbing_row(style: &str) -> RowSprites {
    let prefix = if style == "hardcore" { "absorbing_hardcore" } else { "absorbing" };
    RowSprites {
        background: sprite_or("hud/heart/container.png", "hud/heart/container.png"),
        full: sprite_or(&format!("hud/heart/{prefix}_full.png"), "hud/heart/absorbing_full.png"),
        half: sprite_or(&format!("hud/heart/{prefix}_half.png"), "hud/heart/absorbing_half.png"),
        background_flash: sprite_or("hud/heart/container_blinking.png", "hud/heart/container_blinking.png"),
        full_flash: sprite_or(&format!("hud/heart/{prefix}_full_blinking.png"), "hud/heart/absorbing_full_blinking.png"),
        half_flash: sprite_or(&format!("hud/heart/{prefix}_half_blinking.png"), "hud/heart/absorbing_half_blinking.png"),
    }
}

pub struct FrameStyle {
    health: RowSprites,
    food: RowSprites,
    absorbing: RowSprites,
    exp_background: Rc<Sprite>,
    exp_progress: Rc<Sprite>,
    hotbar: Rc<Sprite>,
    hotbar_offhand: Rc<Sprite>,
    hotbar_selection: Rc<Sprite>,
    saturation_full: Rc<Sprite>,
    saturation_half: Rc<Sprite>,
    air: Rc<Sprite>,
    air_empty: Rc<Sprite>,
    air_bursting: Rc<Sprite>,
    armor_empty: Rc<Sprite>,
    armor_full: Rc<Sprite>,
    armor_half: Rc<Sprite>,
}

impl FrameStyle {
    pub fn load(config: &HudConfig) -> Self {
        let elements = &config.elements;
        let exp_prefix = if elements.exp_bar.style == "jump" { "jump_bar" } else { "experience_bar" };
        FrameStyle {
            health: health_row(&elements.health.style),
            food: food_row(&elements.food.style),
            absorbing: absorbing_row(&elements.absorbing.style),
            exp_background: sprite_or(&format!("hud/experience_bar/{exp_prefix}_background.png"), "hud/experience_bar/experience_bar_background.png"),
            exp_progress: sprite_or(&format!("hud/experience_bar/{exp_prefix}_progress.png"), "hud/experience_bar/experience_bar_progress.png"),
            hotbar: sprite_or("hud/hotbar/hotbar.png", "hud/hotbar/hotbar.png"),
            hotbar_offhand: sprite_or("hud/hotbar/hotbar_offhand.png", "hud/hotbar/hotbar_offhand.png"),
            hotbar_selection: sprite_or("hud/hotbar/hotbar_selection.png", "hud/hotbar/hotbar_selection.png"),
            saturation_full: sprite_or("hud/food/saturation_full.png", "hud/food/saturation_full.png"),
            saturation_half: sprite_or("hud/food/saturation_half.png", "hud/food/saturation_half.png"),
            air: sprite_or("hud/air/air.png", "hud/air/air.png"),
            air_empty: sprite_or("hud/air/air_empty.png", "hud/air/air_empty.png"),
            air_bursting: sprite_or("hud/air/air_bursting.png", "hud/air/air_bursting.png"),
            armor_empty: sprite_or("hud/armor/armor_empty.png", "hud/armor/armor_empty.png"),
            armor_full: sprite_or("hud/armor/armor_full.png", "hud/armor/armor_full.png"),
            armor_half: sprite_or("hud/armor/armor_half.png", "hud/armor/armor_half.png"),
        }
    }
}

pub fn draw(frame: &mut Frame, layout: &Layout, style: &FrameStyle, config: &HudConfig, icons: &[Option<SlotIcon>], overlay: &Overlay) {
    frame.clear();
    let visible = layout.visible;
    let core_left = layout.core_left;
    let core_right = core_left + layout.core_width;
    let icon = layout.icon_size;
    let gap = layout.gap;

    if visible.hotbar && layout.offhand.left {
        let rect = layout.offhand_box_rect(0);
        frame.draw(&style.hotbar_offhand, rect.left, rect.top, rect.width, rect.height);
    }
    if visible.hotbar && layout.offhand.right {
        let rect = layout.offhand_box_rect(1);
        frame.draw_mirrored(&style.hotbar_offhand, rect.left, rect.top, rect.width, rect.height);
    }

    if visible.health {
        draw_heart_row(frame, &style.health, core_left, layout.health_top, icon, gap, &config.elements.health, overlay.heart_flash);
    }
    if visible.absorbing {
        draw_absorbing(frame, &style.absorbing, core_left, layout, &config.elements.absorbing);
    }
    if visible.armor {
        draw_row(frame, &style.armor_empty, &style.armor_full, &style.armor_half, core_left, core_right, layout.armor_top, icon, gap, &config.elements.armor, false);
    }
    if visible.food {
        let food = &config.elements.food;
        draw_row(frame, &style.food.background, &style.food.full, &style.food.half, core_left, core_right, layout.food_top, icon, gap, food, true);
        draw_saturation(frame, &style.saturation_full, &style.saturation_half, core_right, layout.food_top, icon, gap, food.saturation, food.max);
    }
    if visible.air {
        draw_air(frame, &style.air_empty, &style.air, &style.air_bursting, core_left, core_right, layout.air_top, icon, gap, &config.elements.air, overlay.air_burst);
    }
    if visible.exp_bar {
        frame.draw(&style.exp_background, core_left, layout.exp_top, layout.core_width, layout.exp_height);
        let progress = (config.elements.exp_bar.value / 100.0).clamp(0.0, 1.0);
        if progress > 0.0 {
            draw_clipped(frame, &style.exp_progress, core_left, layout.exp_top, layout.core_width, layout.exp_height, core_left + layout.core_width * progress);
        }
    }
    if visible.hotbar {
        frame.draw(&style.hotbar, core_left, layout.hotbar_top, layout.core_width, layout.hotbar_height);
    }

    if visible.hotbar {
        for index in 0..9 {
            let rect = layout.slot_icon_rect(index);
            draw_slot_icon(frame, icons, overlay, index + 2, rect.left, rect.top, layout.slot_size);
        }
        if layout.offhand.left {
            let rect = layout.offhand_icon_rect(0);
            draw_slot_icon(frame, icons, overlay, 0, rect.left, rect.top, rect.width);
        }
        if layout.offhand.right {
            let rect = layout.offhand_icon_rect(1);
            draw_slot_icon(frame, icons, overlay, 1, rect.left, rect.top, rect.width);
        }
    }

    let selection = if overlay.selected_slot >= 2 { overlay.selected_slot } else { overlay.hover_slot };
    if visible.hotbar && (2..=10).contains(&selection) {
        let rect = layout.selection_rect(selection - 2);
        frame.draw(&style.hotbar_selection, rect.left, rect.top, rect.width, rect.height);
    }

    if let Some(drag) = overlay.drag {
        let size = layout::SLOT * layout.scale;
        frame.draw_uniform(&drag.sprite, overlay.drag_x - size / 2.0, overlay.drag_y - size / 2.0, size, size);
    }
}

fn draw_slot_icon(frame: &mut Frame, icons: &[Option<SlotIcon>], overlay: &Overlay, index: i32, left: f32, top: f32, size: f32) {
    let Some(Some(icon)) = icons.get(index as usize) else {
        return;
    };
    if overlay.drag.is_some() && overlay.drag_source == index {
        return;
    }
    if overlay.dimmed_slot == index {
        frame.draw_alpha(&icon.sprite, left, top, size, size, 128);
    } else {
        frame.draw(&icon.sprite, left, top, size, size);
    }
}

fn draw_row(frame: &mut Frame, background: &Rc<Sprite>, full: &Rc<Sprite>, half: &Rc<Sprite>, left: f32, right: f32, top: f32, icon: f32, gap: f32, element: &Element, right_aligned: bool) {
    let slots = (element.max_i() / 2).max(0);
    let full_count = (element.value / 2.0).floor() as i32;
    let has_half = (element.value as i32) % 2 == 1;
    let step = icon + gap;

    for index in 0..slots {
        let x = if right_aligned {
            right - (index + 1) as f32 * step + gap
        } else {
            left + index as f32 * step
        };
        frame.draw(background, x, top, icon, icon);
        if index < full_count {
            frame.draw(full, x, top, icon, icon);
        } else if index == full_count && has_half {
            frame.draw(half, x, top, icon, icon);
        }
    }
}

fn draw_heart_row(frame: &mut Frame, row: &RowSprites, left: f32, top: f32, icon: f32, gap: f32, element: &Element, flash: Option<f32>) {
    let slots = (element.max_i() / 2).max(0);
    let step = icon + gap;
    let full_count = (element.value / 2.0).floor() as i32;
    let has_half = (element.value as i32) % 2 == 1;
    let previous_full = flash.map(|value| (value / 2.0).floor() as i32).unwrap_or(0);
    let previous_half = flash.map(|value| (value as i32) % 2 == 1).unwrap_or(false);

    for index in 0..slots {
        let x = left + index as f32 * step;
        frame.draw(if flash.is_some() { &row.background_flash } else { &row.background }, x, top, icon, icon);
        if index < previous_full && index >= full_count {
            frame.draw(&row.full_flash, x, top, icon, icon);
        } else if index == previous_full && previous_half && index >= full_count && !(index == full_count && has_half) {
            frame.draw(&row.half_flash, x, top, icon, icon);
        }
    }
    for index in 0..slots {
        let x = left + index as f32 * step;
        if index < full_count {
            frame.draw(&row.full, x, top, icon, icon);
        } else if index == full_count && has_half {
            frame.draw(&row.half, x, top, icon, icon);
        }
    }
}

fn draw_absorbing(frame: &mut Frame, row: &RowSprites, left: f32, layout: &Layout, element: &Element) {
    let slots = (element.max_i() / 2).max(0);
    let step = layout.icon_size + layout.gap;
    let full_count = (element.value / 2.0).floor() as i32;
    let has_half = (element.value as i32) % 2 == 1;

    for index in (0..slots).rev() {
        let line = (index as f32 / layout::ABSORBING_PER_ROW).floor();
        let column = index as f32 % layout::ABSORBING_PER_ROW;
        let x = left + column * step;
        let y = layout.absorbing.top
            + (layout.absorbing.rows as f32 - 1.0 - line) * (layout.icon_size + layout.absorbing.row_gap);
        frame.draw(&row.background, x, y, layout.icon_size, layout.icon_size);
        if index < full_count {
            frame.draw(&row.full, x, y, layout.icon_size, layout.icon_size);
        } else if index == full_count && has_half {
            frame.draw(&row.half, x, y, layout.icon_size, layout.icon_size);
        }
    }
}

fn draw_air(frame: &mut Frame, empty: &Rc<Sprite>, full: &Rc<Sprite>, bursting: &Rc<Sprite>, _left: f32, right: f32, top: f32, icon: f32, gap: f32, element: &Element, burst: Option<(i32, i32)>) {
    let slots = (element.max_i() / 2).max(0);
    let full_count = (element.value / 2.0).floor() as i32;
    let step = icon + gap;

    for index in 0..slots {
        let x = right - (index + 1) as f32 * step + gap;
        if let Some((from, to)) = burst {
            if index >= from && index < to {
                frame.draw(bursting, x, top, icon, icon);
                continue;
            }
        }
        if index < full_count {
            frame.draw(full, x, top, icon, icon);
        } else {
            frame.draw(empty, x, top, icon, icon);
        }
    }
}

fn draw_saturation(frame: &mut Frame, full: &Rc<Sprite>, half: &Rc<Sprite>, right: f32, top: f32, icon: f32, gap: f32, value: f32, max: f32) {
    let slots = (max.round() as i32 / 2).max(0);
    let step = icon + gap;
    let full_count = (value / 2.0).floor() as i32;
    let has_half = (value as i32) % 2 == 1;

    for index in 0..slots {
        let x = right - (index + 1) as f32 * step + gap;
        if index < full_count {
            frame.draw(full, x, top, icon, icon);
        } else if index == full_count && has_half {
            frame.draw(half, x, top, icon, icon);
        }
    }
}

fn draw_clipped(frame: &mut Frame, sprite: &Rc<Sprite>, left: f32, top: f32, width: f32, height: f32, clip_right: f32) {
    let visible_width = (clip_right - left).max(0.0);
    if visible_width <= 0.0 {
        return;
    }
    let ratio = visible_width / width;
    let source_width = sprite.width as f32 * ratio;
    // 进度条只在右侧裁切，左侧保持不变
    let copy = Sprite {
        width: (source_width.round() as u32).max(1),
        height: sprite.height,
        pixels: sprite.pixels.clone(),
    };
    frame.draw(&copy, left, top, visible_width, height);
}
