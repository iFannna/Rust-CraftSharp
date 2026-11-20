//! 灰色蒙版：铺满主屏的黑色分层窗口，鼠标穿透。
//! 用整屏 DIB 走 UpdateLayeredWindow，避免 LWA 在本机不出图。

use std::cell::RefCell;

use crate::hud::host::{Event, Host, Options};

struct Overlay {
    host: Host,
    pixels: Vec<u32>,
    size: (u32, u32),
    alpha: u32,
}

fn ignore(_: Event) {}

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

/// 按不透明度显示或隐藏蒙版，透明度是 0-100 的百分比。
pub fn set_visible(visible: bool, opacity: f64) {
    OVERLAY.with(|cell| {
        let mut slot = cell.borrow_mut();
        if !visible {
            if let Some(overlay) = slot.as_ref() {
                overlay.host.hide();
            }
            return;
        }

        if slot.is_none() {
            let options = Options { click_through: true, desktop: false };
            let Some(host) =
                Host::create("CraftSharpOverlay", "CraftSharp Overlay", options, ignore)
            else {
                return;
            };
            *slot = Some(Overlay { host, pixels: Vec::new(), size: (0, 0), alpha: u32::MAX });
        }
        let Some(overlay) = slot.as_mut() else { return };

        let monitor = overlay.host.primary_area();
        let width = (monitor.right - monitor.left).max(1) as u32;
        let height = (monitor.bottom - monitor.top).max(1) as u32;
        let alpha = (opacity.clamp(0.0, 100.0) / 100.0 * 255.0).round() as u32;

        if overlay.size != (width, height) || overlay.alpha != alpha {
            overlay.pixels = vec![alpha << 24; (width * height) as usize];
            overlay.size = (width, height);
            overlay.alpha = alpha;
        }

        overlay
            .host
            .present_pixels(width, height, &overlay.pixels, monitor.left, monitor.top);
        overlay.host.show();
        // 蒙版压住普通窗口，但留在原生 HUD 之下；否则会挡住快捷栏的拖放命中
        overlay.host.drop_topmost();
    });
}
