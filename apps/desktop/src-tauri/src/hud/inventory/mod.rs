//! 物品栏：容器配置与平台实现分离。

use serde::Deserialize;

use crate::hud::config::Point;
use crate::hud::{text, tooltip};
use crate::slots::{self, Scope, SlotItem};

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlayerCfg {
    pub skin_name: String,
    pub skin_type: String,
    pub skin_path: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct InventoryCfg {
    pub visible: bool,
    pub locked: bool,
    pub remember_position: bool,
    pub position: Option<Point>,
    pub gray_overlay: bool,
    pub gray_overlay_opacity: f64,
    pub hide_status_bar: bool,
    pub click_mode: String,
    pub style: String,
    pub shared_data: bool,
    pub hover_effect: bool,
    pub show_model: bool,
    pub show_tooltip: bool,
    pub tooltip_show_file_name: bool,
    pub tooltip_show_original_name: bool,
    pub tooltip_show_file_path: bool,
    pub tooltip_show_file_type: bool,
    pub file_name_color: String,
    pub cut_slot: Option<String>,
    pub drop_key: String,
    pub open_inventory: String,
    pub player: PlayerCfg,
}

impl Default for InventoryCfg {
    fn default() -> Self {
        InventoryCfg {
            visible: false,
            locked: false,
            remember_position: false,
            position: None,
            gray_overlay: true,
            gray_overlay_opacity: 75.0,
            hide_status_bar: false,
            click_mode: "single".into(),
            style: "inventory.png".into(),
            shared_data: true,
            hover_effect: true,
            show_model: true,
            show_tooltip: false,
            tooltip_show_file_name: true,
            tooltip_show_original_name: false,
            tooltip_show_file_path: false,
            tooltip_show_file_type: false,
            file_name_color: "#FCFCFC".into(),
            cut_slot: None,
            drop_key: "q".into(),
            open_inventory: "e".into(),
            player: PlayerCfg::default(),
        }
    }
}

impl InventoryCfg {
    pub fn scope(&self) -> Scope {
        Scope { style: self.style.clone(), shared: self.shared_data }
    }
}

const COLOR_ORIGINAL_NAME: u32 = 0xfffc_fc54;
const COLOR_FILE_PATH: u32 = 0xffa8_a8a8;
const COLOR_FILE_TYPE: u32 = 0xff54_54fc;
const COLOR_FILE_MISSING: u32 = 0xfffc_5454;

fn file_stem(name: &str) -> &str {
    match name.rfind('.') {
        Some(index) if index > 0 => &name[..index],
        _ => name,
    }
}

fn file_extension(name: &str) -> &str {
    match name.rfind('.') {
        Some(index) if index > 0 => &name[index..],
        _ => "",
    }
}

/// 悬停提示内容：按配置裁剪文件名、原名、路径与后缀
pub fn tooltip_lines(config: &InventoryCfg, item: &SlotItem) -> Vec<tooltip::TooltipLine> {
    let name = slots::display_name(item);
    if slots::is_missing(&item.path) {
        return vec![
            tooltip::TooltipLine { text: name, color: COLOR_ORIGINAL_NAME },
            tooltip::TooltipLine { text: "文件已丢失".into(), color: COLOR_FILE_MISSING },
        ];
    }

    let color = |setting: &str, stem: &str| {
        if setting == "auto" {
            text::auto_color(stem)
        } else {
            text::parse_color(setting)
        }
    };
    let stem = file_stem(&name);
    let mut lines = Vec::new();
    if config.tooltip_show_file_name {
        lines.push(tooltip::TooltipLine {
            text: stem.to_string(),
            color: color(&config.file_name_color, stem),
        });
    }
    if config.tooltip_show_original_name {
        lines.push(tooltip::TooltipLine { text: name.clone(), color: COLOR_ORIGINAL_NAME });
    }
    if config.tooltip_show_file_path {
        lines.push(tooltip::TooltipLine { text: item.path.clone(), color: COLOR_FILE_PATH });
    }
    if config.tooltip_show_file_type {
        let extension = file_extension(&name);
        lines.push(tooltip::TooltipLine {
            text: if extension.is_empty() { "(无后缀)".to_string() } else { extension.to_string() },
            color: COLOR_FILE_TYPE,
        });
    }
    if lines.is_empty() {
        lines.push(tooltip::TooltipLine {
            text: stem.to_string(),
            color: color(&config.file_name_color, stem),
        });
    }
    lines
}

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;
