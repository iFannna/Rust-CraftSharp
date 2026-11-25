//! 灰色蒙版：铺满主屏的黑色分层窗口，鼠标穿透。
//! 用整屏 DIB 走 UpdateLayeredWindow，避免 LWA 在本机不出图。

use std::cell::RefCell;

use crate::hud::host::{Event, Host, Options};

struct Overlay {
    host: Host,
    pixels: Vec<u32>,
    size: (u32, u32),
    alpha: u32,
    repaints: u8,
    mapped: bool,
}

/// 映射由窗口管理器异步完成，重挂载前提交的像素会丢，映射后再补两帧
const REPAINT: usize = 1;

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

fn on_event(event: Event) {
    if !matches!(event, Event::Timer(REPAINT)) {
        return;
    }
    OVERLAY.with(|cell| {
        let mut slot = cell.borrow_mut();
        let Some(overlay) = slot.as_mut() else { return };
        if overlay.repaints == 0 || overlay.size.0 == 0 {
            overlay.host.timer(REPAINT, 0, false);
            return;
        }
        overlay.repaints -= 1;
        if overlay.repaints == 0 {
            overlay.host.timer(REPAINT, 0, false);
        }
        let monitor = overlay.host.work_area();
        overlay.host.present_pixels(
            overlay.size.0,
            overlay.size.1,
            &overlay.pixels,
            monitor.left,
            monitor.top,
        );
    });
}

fn create(slot: &mut Option<Overlay>) {
    if slot.is_some() {
        return;
    }
    // X11 没有“普通窗口之上、HUD 之下”的层，蒙版改走受管浮层，
    // 顺序由物品栏显示时重新提层决定
    let options = Options {
        click_through: true,
        desktop: false,
        panel: cfg!(target_os = "linux"),
    };
    let Some(host) = Host::create("CraftSharpOverlay", "CraftSharp Overlay", options, on_event) else {
        return;
    };
    *slot = Some(Overlay {
        host,
        pixels: Vec::new(),
        size: (0, 0),
        alpha: u32::MAX,
        repaints: 0,
        mapped: false,
    });
}

fn resize(overlay: &mut Overlay, alpha: u32) {
    let monitor = overlay.host.work_area();
    let width = (monitor.right - monitor.left).max(1) as u32;
    let height = (monitor.bottom - monitor.top).max(1) as u32;
    if overlay.size != (width, height) || overlay.alpha != alpha {
        overlay.pixels = vec![alpha << 24; (width * height) as usize];
        overlay.size = (width, height);
        overlay.alpha = alpha;
    }
}

fn present(overlay: &mut Overlay) {
    let monitor = overlay.host.work_area();
    overlay
        .host
        .present_pixels(overlay.size.0, overlay.size.1, &overlay.pixels, monitor.left, monitor.top);
}

/// 隐藏时清成透明而不是收起窗口，下次显示只换像素，不带动窗口的放大动画
fn clear(overlay: &mut Overlay) {
    overlay.host.timer(REPAINT, 0, false);
    overlay.repaints = 0;
    if overlay.size.0 == 0 {
        return;
    }
    #[cfg(target_os = "linux")]
    {
        overlay.pixels.iter_mut().for_each(|pixel| *pixel = 0);
        overlay.alpha = 0;
        if overlay.mapped {
            present(overlay);
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        overlay.host.hide();
        overlay.mapped = false;
    }
}

/// 启动时预创建并先映射好透明蒙版，首个显现就不再走窗口映射动画
pub fn prewarm() {
    if !cfg!(target_os = "linux") {
        return;
    }
    OVERLAY.with(|cell| {
        let mut slot = cell.borrow_mut();
        create(&mut slot);
        let Some(overlay) = slot.as_mut() else { return };
        resize(overlay, 0);
        if !overlay.mapped {
            overlay.host.show();
            overlay.mapped = true;
        }
        present(overlay);
        // 预映射同样会经历重挂载，补帧把透明内容补上
        overlay.repaints = 2;
        overlay.host.timer(REPAINT, 120, true);
        overlay.host.drop_topmost();
    });
}

/// 按不透明度显示或隐藏蒙版，透明度是 0-100 的百分比。
pub fn set_visible(visible: bool, opacity: f64) {
    OVERLAY.with(|cell| {
        let mut slot = cell.borrow_mut();
        if !visible {
            if let Some(overlay) = slot.as_mut() {
                clear(overlay);
            }
            return;
        }

        create(&mut slot);
        let Some(overlay) = slot.as_mut() else { return };
        let alpha = (opacity.clamp(0.0, 100.0) / 100.0 * 255.0).round() as u32;
        resize(overlay, alpha);

        // 窗口映射后不再重复映射和提层，避免把蒙版顶到物品栏之上
        if !overlay.mapped {
            overlay.host.show();
            overlay.mapped = true;
            overlay.host.drop_topmost();
        }
        present(overlay);
        // 仅 X11 需要：显示到映射完成之间提交的像素会丢
        if cfg!(target_os = "linux") && overlay.repaints == 0 {
            overlay.repaints = 2;
            overlay.host.timer(REPAINT, 120, true);
        }
    });
}
