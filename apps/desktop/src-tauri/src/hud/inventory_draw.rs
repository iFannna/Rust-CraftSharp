//! 物品栏布局与绘制：容器样式表、格子矩形、画布合成。

use std::rc::Rc;

use serde::Deserialize;

use crate::hud::sprite::{self, Frame, Sprite};

#[derive(Clone, Copy)]
pub struct Style {
    pub file: &'static str,
    pub coords: &'static str,
}

/// 顺序与原样式预览一致，标签页物品栏沿用 inventory 坐标。
pub const STYLES: [Style; 15] = [
    Style { file: "brewing_stand.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/brewing_stand.json") },
    Style { file: "cartography_table.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/cartography_table.json") },
    Style { file: "crafter.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/crafter.json") },
    Style { file: "crafting_table.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/crafting_table.json") },
    Style { file: "dispenser.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/dispenser.json") },
    Style { file: "furnace.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/furnace.json") },
    Style { file: "generic_54.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/generic_54.json") },
    Style { file: "grindstone.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/grindstone.json") },
    Style { file: "hopper.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/hopper.json") },
    Style { file: "horse.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/horse.json") },
    Style { file: "inventory.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/inventory.json") },
    Style { file: "nautilus.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/nautilus.json") },
    Style { file: "shulker_box.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/shulker_box.json") },
    Style { file: "smithing.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/smithing.json") },
    Style { file: "tab_inventory.png", coords: include_str!("../../../../../assets/minecraft/textures/gui/container/coordinate/inventory.json") },
];

const DEFAULT_STYLE: &str = "inventory.png";

pub fn find_style(file: &str) -> Style {
    STYLES
        .iter()
        .copied()
        .find(|style| style.file == file)
        .unwrap_or_else(|| STYLES.iter().copied().find(|style| style.file == DEFAULT_STYLE).unwrap())
}

pub fn container_sprite(style: Style) -> Option<Rc<Sprite>> {
    sprite::load(&format!("gui/container/{}", style.file))
}

#[derive(Deserialize)]
struct Coord {
    slot_id: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(Clone)]
pub struct SlotBox {
    pub id: String,
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
}

pub struct Layout {
    pub width: f32,
    pub height: f32,
    pub slot_size: f32,
    pub slots: Vec<SlotBox>,
    /// 全部格子的外接矩形，拖出判定用
    pub bounds: (f32, f32, f32, f32),
}

pub fn compute(style: Style, unit: f32, background: &Sprite) -> Layout {
    let coords: Vec<Coord> = serde_json::from_str(style.coords).unwrap_or_default();
    let mut slots = Vec::new();
    for coord in coords {
        if coord.slot_id == "player" {
            continue;
        }
        slots.push(SlotBox {
            id: coord.slot_id,
            left: coord.x * unit,
            top: coord.y * unit,
            width: coord.width * unit,
            height: coord.height * unit,
        });
    }

    let mut left = f32::MAX;
    let mut top = f32::MAX;
    let mut right = f32::MIN;
    let mut bottom = f32::MIN;
    for slot in &slots {
        left = left.min(slot.left);
        top = top.min(slot.top);
        right = right.max(slot.left + slot.width);
        bottom = bottom.max(slot.top + slot.height);
    }
    if slots.is_empty() {
        left = 0.0;
        top = 0.0;
        right = 0.0;
        bottom = 0.0;
    }

    Layout {
        width: background.width as f32 * unit,
        height: background.height as f32 * unit,
        slot_size: 16.0 * unit,
        slots,
        bounds: (left, top, right, bottom),
    }
}

pub fn slot_at(layout: &Layout, x: f32, y: f32) -> Option<usize> {
    layout
        .slots
        .iter()
        .position(|slot| x >= slot.left && x < slot.left + slot.width && y >= slot.top && y < slot.top + slot.height)
}

pub fn slot_index(layout: &Layout, id: &str) -> Option<usize> {
    layout.slots.iter().position(|slot| slot.id == id)
}

#[derive(Clone)]
pub struct SlotIcon {
    pub sprite: Rc<Sprite>,
}

/// 与 Canvas 一致的半透明蒙版色，已预乘 alpha。
const HOVER_WHITE: u32 = 0x8080_8080;
const HOVER_GREEN: u32 = 0x7021_7025;

pub struct Model<'a> {
    pub layout: &'a Layout,
    pub background: &'a Sprite,
    pub icons: &'a [Option<SlotIcon>],
    pub hover: Option<usize>,
    pub hover_green: bool,
    pub drag_source: Option<usize>,
    pub dimmed: Option<usize>,
}

pub fn draw(frame: &mut Frame, model: &Model) {
    frame.clear();
    frame.draw(model.background, 0.0, 0.0, model.layout.width, model.layout.height);

    for (index, slot) in model.layout.slots.iter().enumerate() {
        let Some(Some(icon)) = model.icons.get(index) else { continue };
        if model.drag_source == Some(index) {
            continue;
        }
        if model.dimmed == Some(index) {
            frame.draw_alpha(&icon.sprite, slot.left, slot.top, slot.width, slot.height, 128);
        } else {
            frame.draw(&icon.sprite, slot.left, slot.top, slot.width, slot.height);
        }
    }

    if let Some(index) = model.hover {
        if let Some(slot) = model.layout.slots.get(index) {
            let color = if model.hover_green { HOVER_GREEN } else { HOVER_WHITE };
            frame.fill(slot.left, slot.top, slot.width, slot.height, color);
        }
    }
}
