//! 灰色蒙版：铺满主屏的黑色分层窗口，鼠标穿透。
//! 用整屏 DIB 走 UpdateLayeredWindow，避免 LWA 在本机不出图。

use std::cell::RefCell;

use crate::hud::win32 as w;
use crate::hud::win32::Dib;

struct Overlay {
    hwnd: w::Hwnd,
    dib: Option<Dib>,
    alpha: u32,
}

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

unsafe extern "system" fn wndproc(hwnd: w::Hwnd, message: u32, wparam: usize, lparam: isize) -> isize {
    match message {
        w::WM_MOUSEACTIVATE => return 3,
        w::WM_NCHITTEST => return -1,
        w::WM_ERASEBKGND => return 1,
        w::WM_PAINT => {
            w::validate(hwnd);
            return 0;
        }
        _ => {}
    }
    w::DefWindowProcW(hwnd, message, wparam, lparam)
}

/// 按不透明度显示或隐藏蒙版，透明度是 0-100 的百分比。
pub fn set_visible(visible: bool, opacity: f64) {
    OVERLAY.with(|cell| {
        let mut slot = cell.borrow_mut();
        if !visible {
            if let Some(overlay) = slot.as_ref() {
                // SAFETY: 只隐藏窗口
                unsafe {
                    w::ShowWindow(overlay.hwnd, w::SW_HIDE);
                }
            }
            return;
        }

        if slot.is_none() {
            let hwnd = w::create_named_window(
                "CraftSharpOverlay",
                "CraftSharp Overlay",
                wndproc,
                w::WS_EX_TRANSPARENT | w::WS_EX_NOACTIVATE,
            );
            if hwnd == 0 {
                return;
            }
            *slot = Some(Overlay { hwnd, dib: None, alpha: 0 });
        }
        let Some(overlay) = slot.as_mut() else { return };

        let monitor = w::primary_rect();
        let width = (monitor.right - monitor.left).max(1) as u32;
        let height = (monitor.bottom - monitor.top).max(1) as u32;
        let alpha = (opacity.clamp(0.0, 100.0) / 100.0 * 255.0).round() as u32;

        let resized = overlay
            .dib
            .as_ref()
            .map(|dib| dib.width != width || dib.height != height)
            .unwrap_or(true);
        if resized {
            overlay.dib = Dib::new(width, height);
            overlay.alpha = u32::MAX;
        }
        let Some(dib) = &overlay.dib else { return };

        if overlay.alpha != alpha {
            let color = alpha << 24;
            // SAFETY: 写自己创建的 DIB，预乘黑色
            for index in 0..(width * height) as usize {
                unsafe {
                    *dib.bits.add(index) = color;
                }
            }
            overlay.alpha = alpha;
        }

        w::update_layered(overlay.hwnd, dib, monitor.left, monitor.top);
        // SAFETY: 只显示窗口，不抢焦点
        unsafe {
            w::ShowWindow(overlay.hwnd, w::SW_SHOWNOACTIVATE);
        }
        // 蒙版压住普通窗口，但留在原生 HUD 之下；否则会挡住快捷栏的拖放命中
        // SAFETY: 只调整层级，不改位置尺寸
        unsafe {
            w::SetWindowPos(
                overlay.hwnd,
                w::HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                w::SWP_NOMOVE | w::SWP_NOSIZE | w::SWP_NOACTIVATE,
            );
        }
    });
}
