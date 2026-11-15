//! 状态栏布局，数值与 WPF 原版一一对应，单位是 MC GUI 像素乘缩放。

pub const CORE_WIDTH: f32 = 182.0;
pub const HOTBAR_HEIGHT: f32 = 22.0;
pub const EXP_HEIGHT: f32 = 5.0;
pub const EXP_MARGIN: f32 = 2.0;
pub const ICON: f32 = 9.0;
pub const ICON_GAP: f32 = -1.0;
pub const ROW_GAP: f32 = 1.0;
pub const MARGIN: f32 = 3.0;
pub const SLOT: f32 = 16.0;
pub const SLOT_SPACING: f32 = 4.0;
pub const DROP_ZONE_EXPANSION: f32 = 2.0;
pub const SELECTION_WIDTH: f32 = 24.0;
pub const SELECTION_HEIGHT: f32 = 23.0;
pub const OFFHAND_SIZE: f32 = 22.0;
pub const OFFHAND_SPACING: f32 = 7.0;
pub const ABSORBING_PER_ROW: f32 = 10.0;
pub const ABSORBING_MAX_GAP_ADJUSTMENT: f32 = 7.0;
/// 左右各留 1 MC 像素，容纳比格子宽 4 像素的选中框
pub const SIDE_PADDING: f32 = 1.0;

/// 全局格子索引对应的格子 id：0 左副手、1 右副手、2-10 主快捷栏。
pub fn slot_id(index: i32) -> String {
    match index {
        0 => "hotbar_left_offhand".to_string(),
        1 => "hotbar_right_offhand".to_string(),
        value => format!("hotbar_{}", value - 2),
    }
}

/// 格子 id 还原成全局索引，非格子 id 返回 None。
pub fn slot_index(id: &str) -> Option<i32> {
    match id {
        "hotbar_left_offhand" => Some(0),
        "hotbar_right_offhand" => Some(1),
        _ => id.strip_prefix("hotbar_")?.parse::<i32>().ok().map(|value| value + 2),
    }
}

#[derive(Clone, Copy, Default, Debug)]
pub struct Rect {
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Offhand {
    pub left: bool,
    pub right: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Visibility {
    pub health: bool,
    pub food: bool,
    pub air: bool,
    pub armor: bool,
    pub absorbing: bool,
    pub exp_bar: bool,
    pub hotbar: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Absorbing {
    pub top: f32,
    pub rows: i32,
    pub row_gap: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct Layout {
    pub scale: f32,
    pub core_width: f32,
    pub core_left: f32,
    pub width: f32,
    pub height: f32,
    pub icon_size: f32,
    pub slot_size: f32,
    pub gap: f32,
    pub hotbar_top: f32,
    pub hotbar_height: f32,
    pub exp_top: f32,
    pub exp_height: f32,
    pub health_top: f32,
    pub armor_top: f32,
    pub food_top: f32,
    pub air_top: f32,
    pub absorbing: Absorbing,
    pub offhand: Offhand,
    pub visible: Visibility,
}

/// 复刻 WPF StackPanel 重力布局：整块贴底，隐藏元素后上方元素向下掉落。
pub fn compute(scale: f32, offhand: Offhand, visible: Visibility, max_absorption: i32) -> Layout {
    let icon = ICON * scale;
    let gap = ICON_GAP * scale;
    let row_gap = ROW_GAP * scale;
    let core_width = CORE_WIDTH * scale;
    let hotbar_height = HOTBAR_HEIGHT * scale;
    let exp_height = EXP_HEIGHT * scale;
    let exp_margin = EXP_MARGIN * scale;
    let offhand_width = (OFFHAND_SIZE + OFFHAND_SPACING) * scale;
    let padding = SIDE_PADDING * scale;
    let core_left = padding + if offhand.left { offhand_width } else { 0.0 };
    let width = core_width + core_left + if offhand.right { offhand_width } else { 0.0 } + padding;

    let absorbing_slots = (max_absorption / 2).max(0);
    let rows = ((absorbing_slots as f32 / ABSORBING_PER_ROW).ceil() as i32).max(1);
    let gap_adjustment = (rows - 1).min(ABSORBING_MAX_GAP_ADJUSTMENT as i32);
    let absorbing_row_gap = row_gap - gap_adjustment as f32 * scale;
    let absorbing_height = rows as f32 * icon + (rows - 1) as f32 * absorbing_row_gap;

    let mut left = 0.0;
    let mut health_offset = 0.0;
    let mut absorbing_offset = 0.0;
    let mut armor_offset = 0.0;
    if visible.health {
        health_offset = left;
        left += icon;
    }
    if visible.absorbing {
        left += absorbing_row_gap;
        absorbing_offset = left;
        left += absorbing_height;
    }
    if visible.armor {
        left += row_gap;
        armor_offset = left;
        left += icon;
    }
    let left_height = left;

    let mut right = 0.0;
    let mut food_offset = 0.0;
    let mut air_offset = 0.0;
    if visible.food {
        food_offset = right;
        right += icon;
    }
    if visible.air {
        right += row_gap;
        air_offset = right;
        right += icon;
    }
    let right_height = right;

    let status_height = left_height.max(right_height);
    let height = (if visible.hotbar { hotbar_height } else { 0.0 })
        + (if visible.exp_bar { exp_margin + exp_height } else { 0.0 })
        + row_gap
        + status_height;

    let mut cursor = height;
    let mut hotbar_top = cursor;
    if visible.hotbar {
        cursor -= hotbar_height;
        hotbar_top = cursor;
    }
    let mut exp_top = cursor;
    if visible.exp_bar {
        cursor -= exp_margin + exp_height;
        exp_top = cursor;
    }
    cursor -= row_gap;
    let status_bottom = cursor;

    Layout {
        scale,
        core_width,
        core_left,
        width,
        height,
        icon_size: icon,
        slot_size: SLOT * scale,
        gap,
        hotbar_top,
        hotbar_height,
        exp_top,
        exp_height,
        health_top: status_bottom - health_offset - icon,
        armor_top: status_bottom - armor_offset - icon,
        food_top: status_bottom - food_offset - icon,
        air_top: status_bottom - air_offset - icon,
        absorbing: Absorbing {
            top: status_bottom - absorbing_offset - absorbing_height,
            rows,
            row_gap: absorbing_row_gap,
        },
        offhand,
        visible,
    }
}

impl Layout {
    pub fn slot_drop_rect(&self, index: i32) -> Rect {
        let scale = self.scale;
        Rect {
            left: self.core_left + (MARGIN - DROP_ZONE_EXPANSION + index as f32 * (SLOT + SLOT_SPACING)) * scale,
            top: self.hotbar_top + (MARGIN - DROP_ZONE_EXPANSION) * scale,
            width: (SLOT + 2.0 * DROP_ZONE_EXPANSION) * scale,
            height: (SLOT + 2.0 * DROP_ZONE_EXPANSION) * scale,
        }
    }

    pub fn slot_icon_rect(&self, index: i32) -> Rect {
        let scale = self.scale;
        Rect {
            left: self.core_left + (MARGIN + index as f32 * (SLOT + SLOT_SPACING)) * scale,
            top: self.hotbar_top + MARGIN * scale,
            width: SLOT * scale,
            height: SLOT * scale,
        }
    }

    pub fn selection_rect(&self, index: i32) -> Rect {
        let scale = self.scale;
        let column_width = (SLOT + SLOT_SPACING) * scale;
        let canvas_margin = (MARGIN - DROP_ZONE_EXPANSION) * scale;
        Rect {
            left: self.core_left + canvas_margin + index as f32 * column_width + (column_width - SELECTION_WIDTH * scale) / 2.0,
            top: self.hotbar_top - scale,
            width: SELECTION_WIDTH * scale,
            height: SELECTION_HEIGHT * scale,
        }
    }

    pub fn offhand_box_rect(&self, side: usize) -> Rect {
        let size = OFFHAND_SIZE * self.scale;
        let padding = SIDE_PADDING * self.scale;
        Rect {
            left: if side == 0 { padding } else { self.width - size - padding },
            top: self.hotbar_top,
            width: size,
            height: size,
        }
    }

    pub fn offhand_icon_rect(&self, side: usize) -> Rect {
        let box_rect = self.offhand_box_rect(side);
        Rect {
            left: box_rect.left + MARGIN * self.scale,
            top: box_rect.top + MARGIN * self.scale,
            width: SLOT * self.scale,
            height: SLOT * self.scale,
        }
    }

    pub fn offhand_drop_rect(&self, side: usize) -> Rect {
        let box_rect = self.offhand_box_rect(side);
        let size = (SLOT + 2.0 * DROP_ZONE_EXPANSION) * self.scale;
        Rect {
            left: box_rect.left + (MARGIN - DROP_ZONE_EXPANSION) * self.scale,
            top: box_rect.top + (MARGIN - DROP_ZONE_EXPANSION) * self.scale,
            width: size,
            height: size,
        }
    }

    /// 拖出判定范围：快捷栏整行含副手，不含上方的状态行
    pub fn drag_out_rect(&self) -> Rect {
        let mut left = self.core_left;
        let mut right = self.core_left + self.core_width;
        if self.offhand.left {
            left = left.min(self.offhand_box_rect(0).left);
        }
        if self.offhand.right {
            let rect = self.offhand_box_rect(1);
            right = right.max(rect.left + rect.width);
        }
        Rect {
            left,
            top: self.hotbar_top,
            width: right - left,
            height: self.hotbar_height,
        }
    }

    /// 命中测试，返回全局格子索引：0 左副手、1 右副手、2-10 主快捷栏，未命中 -1。
    pub fn slot_at(&self, x: f32, y: f32) -> i32 {
        if !self.visible.hotbar {
            return -1;
        }
        for index in 0..9 {
            if hit(self.slot_drop_rect(index), x, y) {
                return index + 2;
            }
        }
        if self.offhand.left && hit(self.offhand_drop_rect(0), x, y) {
            return 0;
        }
        if self.offhand.right && hit(self.offhand_drop_rect(1), x, y) {
            return 1;
        }
        -1
    }
}

fn hit(rect: Rect, x: f32, y: f32) -> bool {
    x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height
}
