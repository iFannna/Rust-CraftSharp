//! 拖动时跟随光标的浮层图标。独立于状态栏窗口，不受其尺寸约束，
//! 走到格子行外侧也不会被窗口边界裁掉。

use std::cell::RefCell;
use std::ptr;

use crate::hud::sprite::Sprite;
use crate::hud::win32 as w;

struct IconWindow {
    hwnd: w::Hwnd,
    /// 当前图标缓存的指针与尺寸，变化时才重画
    key: (usize, u32),
    dib: Option<w::Dib>,
    shown: bool,
}

thread_local! {
    static WINDOW: RefCell<Option<IconWindow>> = RefCell::new(None);
}

/// 把图标画在屏幕坐标 (x, y) 中心；没有图标时隐藏。
pub fn show(sprite: &Sprite, x: i32, y: i32) {
    if sprite.width == 0 || sprite.height == 0 {
        hide();
        return;
    }

    WINDOW.with(|cell| {
        let mut slot = cell.borrow_mut();
        let window = slot.get_or_insert_with(|| IconWindow {
            hwnd: w::create_overlay(),
            key: (0, 0),
            dib: None,
            shown: false,
        });
        if window.hwnd == 0 {
            return;
        }

        let key = (sprite.pixels.as_ptr() as usize, sprite.width);
        let resized = window
            .dib
            .as_ref()
            .map(|dib| dib.width != sprite.width || dib.height != sprite.height)
            .unwrap_or(true);
        if resized {
            window.dib = w::Dib::new(sprite.width, sprite.height);
        }
        let Some(dib) = &window.dib else { return };

        if resized || window.key != key {
            // SAFETY: 帧缓冲与 DIB 尺寸一致
            unsafe {
                ptr::copy_nonoverlapping(sprite.pixels.as_ptr(), dib.bits, (sprite.width * sprite.height) as usize);
            }
            window.key = key;
        }

        w::update_layered(
            window.hwnd,
            dib,
            x - (sprite.width as i32) / 2,
            y - (sprite.height as i32) / 2,
        );
        if !window.shown {
            window.shown = true;
            // SAFETY: 只是显示窗口且不抢焦点
            unsafe {
                w::ShowWindow(window.hwnd, w::SW_SHOWNOACTIVATE);
            }
            w::raise_overlay(window.hwnd);
        }
    });
}

/// 结束拖动或交接给系统拖放时收起浮层。
pub fn hide() {
    WINDOW.with(|cell| {
        let mut slot = cell.borrow_mut();
        let Some(window) = slot.as_mut() else { return };
        if !window.shown {
            return;
        }
        window.shown = false;
        // SAFETY: 窗口在创建后一直存活
        unsafe {
            w::ShowWindow(window.hwnd, w::SW_HIDE);
        }
    });
}
