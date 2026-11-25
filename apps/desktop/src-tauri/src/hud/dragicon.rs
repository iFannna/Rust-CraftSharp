//! 拖动时跟随光标的浮层图标。独立于状态栏窗口，不受其尺寸约束，
//! 走到格子行外侧也不会被窗口边界裁掉。

use std::cell::RefCell;

use crate::hud::host::{Event, Host, Options};
use crate::hud::sprite::Sprite;

struct IconWindow {
    host: Host,
    shown: bool,
    /// 正在拖动的窗口；只有它有权收起浮层
    owner: &'static str,
}

fn ignore(_: Event) {}

thread_local! {
    static WINDOW: RefCell<Option<IconWindow>> = RefCell::new(None);
}

/// 把图标画在屏幕坐标 (x, y) 中心；没有图标时隐藏。
pub fn show(owner: &'static str, sprite: &Sprite, x: i32, y: i32) {
    if sprite.width == 0 || sprite.height == 0 {
        hide(owner);
        return;
    }

    WINDOW.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            let options = Options { click_through: true, desktop: false, panel: false };
            let Some(host) =
                Host::create("CraftSharpDragIcon", "CraftSharp Drag", options, ignore)
            else {
                return;
            };
            *slot = Some(IconWindow { host, shown: false, owner: "" });
        }
        let Some(window) = slot.as_mut() else { return };
        window.owner = owner;

        window.host.present_pixels(
            sprite.width,
            sprite.height,
            &sprite.pixels,
            x - (sprite.width as i32) / 2,
            y - (sprite.height as i32) / 2,
        );
        if !window.shown {
            window.shown = true;
            window.host.show();
            window.host.raise();
        }
    });
}

/// 只收起当前拖动窗口自己的浮层，避免状态栏刷新把物品栏的分发图标藏掉。
pub fn hide(owner: &'static str) {
    WINDOW.with(|cell| {
        let mut slot = cell.borrow_mut();
        let Some(window) = slot.as_mut() else { return };
        if window.owner != owner || !window.shown {
            return;
        }
        window.shown = false;
        window.host.hide();
    });
}
