//! HUD 配置，由前端控制窗口推送。

use serde::Deserialize;

fn max_default() -> f32 {
    20.0
}

fn visible_default() -> bool {
    true
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    #[serde(default)]
    pub visible: bool,
    #[serde(default)]
    pub style: String,
    /// 自定义数值，未开启映射时生效
    #[serde(default)]
    pub value: f32,
    #[serde(default = "max_default")]
    pub max: f32,
    #[serde(default)]
    pub regen: bool,
    #[serde(default)]
    pub saturation: f32,
    #[serde(default)]
    pub custom: bool,
    /// battery、memory、cpu、gpu
    #[serde(default)]
    pub mapping: String,
}

impl Element {
    pub fn max_i(&self) -> i32 {
        self.max.round() as i32
    }

    pub fn resolved(&self, metrics: &Metrics) -> f32 {
        if self.custom {
            return self.value;
        }
        let ratio = match self.mapping.as_str() {
            "memory" => metrics.memory,
            "cpu" => metrics.cpu,
            "gpu" => metrics.gpu,
            _ => metrics.battery,
        };
        (ratio * self.max as f64).round() as f32
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Metrics {
    pub battery: f64,
    pub memory: f64,
    pub cpu: f64,
    pub gpu: f64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Elements {
    pub health: Element,
    pub food: Element,
    pub air: Element,
    pub armor: Element,
    pub absorbing: Element,
    pub exp_bar: Element,
}

#[derive(Deserialize, Clone, Debug, Default)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub index: i32,
    #[serde(default)]
    pub path: Option<String>,
    /// 文件名标签文本，只有 path 非空时才有
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HudConfig {
    pub scale: f32,
    #[serde(default)]
    pub left_offhand: bool,
    #[serde(default)]
    pub right_offhand: bool,
    #[serde(default)]
    pub hotbar_visible: bool,
    #[serde(default)]
    pub show_target_icon: bool,
    #[serde(default)]
    pub click_mode: String,
    #[serde(default)]
    pub hover_effect: bool,
    #[serde(default)]
    pub locked: bool,
    /// 状态栏整体显隐，设置里关闭后原生窗口隐藏
    #[serde(default = "visible_default")]
    pub visible: bool,
    #[serde(default)]
    pub remember_position: bool,
    #[serde(default)]
    pub position: Option<Point>,
    /// 记录位置时的窗口高度，用于按底边换算
    #[serde(default)]
    pub position_height: Option<i32>,
    #[serde(default)]
    pub file_name_color: String,
    #[serde(default)]
    pub drop_key: String,
    /// 剪贴板剪切中的格子，-1 表示没有
    #[serde(default = "none_slot")]
    pub cut_slot: i32,
    pub elements: Elements,
    #[serde(default)]
    pub slots: Vec<Slot>,
}

fn none_slot() -> i32 {
    -1
}

impl HudConfig {
    pub fn offhand(&self) -> crate::hud::layout::Offhand {
        crate::hud::layout::Offhand {
            left: self.left_offhand,
            right: self.right_offhand,
        }
    }

    pub fn visibility(&self) -> crate::hud::layout::Visibility {
        let elements = &self.elements;
        crate::hud::layout::Visibility {
            health: elements.health.visible,
            food: elements.food.visible,
            air: elements.air.visible,
            armor: elements.armor.visible,
            absorbing: elements.absorbing.visible,
            exp_bar: elements.exp_bar.visible,
            hotbar: self.hotbar_visible,
        }
    }

    pub fn slot(&self, index: i32) -> Option<&Slot> {
        self.slots.iter().find(|slot| slot.index == index && slot.path.is_some())
    }
}
