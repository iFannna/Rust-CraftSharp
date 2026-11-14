//! 像素级鼠标穿透：把画布不透明区域合并成窗口区域，
//! 透明像素既不被绘制也不接收鼠标，点击直接落到桌面。

#![allow(non_snake_case)]

use tauri::{AppHandle, Manager};

const RGN_OR: i32 = 2;

#[link(name = "gdi32")]
extern "system" {
    fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> isize;
    fn CombineRgn(destination: isize, source1: isize, source2: isize, mode: i32) -> i32;
    fn DeleteObject(object: isize) -> i32;
}

#[link(name = "user32")]
extern "system" {
    fn SetWindowRgn(hwnd: isize, region: isize, redraw: i32) -> i32;
}

fn build_region(runs: &[[i32; 4]]) -> isize {
    let region = unsafe { CreateRectRgn(0, 0, 0, 0) };
    for [x, y, width, height] in runs {
        if *width <= 0 || *height <= 0 {
            continue;
        }
        let rect = unsafe { CreateRectRgn(*x, *y, x + width, y + height) };
        unsafe {
            CombineRgn(region, region, rect, RGN_OR);
            DeleteObject(rect);
        }
    }
    region
}

/// 更新窗口形状；设置后窗口只剩不透明像素可点击。
pub fn update(app: &AppHandle, label: &str, runs: Vec<[i32; 4]>) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let Ok(raw) = window.hwnd() else {
        return;
    };
    let hwnd = raw.0 as isize;

    // 形状必须由窗口线程设置
    let _ = app.run_on_main_thread(move || {
        let region = build_region(&runs);
        // redraw 传 0：只换裁剪区域，不触发整窗重绘，避免显隐元素时闪一下
        let applied = unsafe { SetWindowRgn(hwnd, region, 0) };
        if applied == 0 {
            unsafe {
                DeleteObject(region);
            }
        }
    });
}
