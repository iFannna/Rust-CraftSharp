//! GLib / GIO / GdkPixbuf 的最小绑定，只覆盖图标名称查询与光栅化。
//! 这些库随 GTK 一起加载，调用线程安全，不需要 GTK 主循环。

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::ptr;

#[link(name = "glib-2.0")]
extern "C" {
    fn g_free(pointer: *mut c_void);
    fn g_error_free(error: *mut c_void);
    fn g_variant_get_string(value: *mut c_void, length: *mut usize) -> *const c_char;
    fn g_variant_unref(value: *mut c_void);
}

#[link(name = "gobject-2.0")]
extern "C" {
    fn g_object_unref(object: *mut c_void);
}

#[link(name = "gio-2.0")]
extern "C" {
    fn g_file_new_for_path(path: *const c_char) -> *mut c_void;
    fn g_file_query_info(
        file: *mut c_void,
        attributes: *const c_char,
        flags: c_int,
        cancellable: *mut c_void,
        error: *mut *mut c_void,
    ) -> *mut c_void;
    fn g_file_info_get_icon(info: *mut c_void) -> *mut c_void;
    fn g_themed_icon_get_names(icon: *mut c_void) -> *const *const c_char;
    fn g_settings_new(schema: *const c_char) -> *mut c_void;
    fn g_settings_get_string(settings: *mut c_void, key: *const c_char) -> *mut c_char;
    fn g_settings_get_user_value(settings: *mut c_void, key: *const c_char) -> *mut c_void;
}

#[link(name = "gdk_pixbuf-2.0")]
extern "C" {
    fn gdk_pixbuf_new_from_file_at_scale(
        filename: *const c_char,
        width: c_int,
        height: c_int,
        preserve_aspect_ratio: c_int,
        error: *mut *mut c_void,
    ) -> *mut c_void;
    fn gdk_pixbuf_get_width(pixbuf: *const c_void) -> c_int;
    fn gdk_pixbuf_get_height(pixbuf: *const c_void) -> c_int;
    fn gdk_pixbuf_get_n_channels(pixbuf: *const c_void) -> c_int;
    fn gdk_pixbuf_get_rowstride(pixbuf: *const c_void) -> c_int;
    fn gdk_pixbuf_get_has_alpha(pixbuf: *const c_void) -> c_int;
    fn gdk_pixbuf_get_pixels(pixbuf: *const c_void) -> *mut u8;
}

fn c_path(path: &Path) -> Option<CString> {
    CString::new(path.as_os_str().as_bytes()).ok()
}

fn free_error(error: *mut c_void) {
    if !error.is_null() {
        // SAFETY: 错误对象只由 GIO / GdkPixbuf 创建，交给 GLib 释放
        unsafe { g_error_free(error) };
    }
}

fn take_string(raw: *mut c_char) -> Option<String> {
    if raw.is_null() {
        return None;
    }
    // SAFETY: GLib 返回以 NUL 结尾的字符串，拷贝后自行释放
    let value = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
    unsafe { g_free(raw as *mut c_void) };
    Some(value)
}

/// 与文件管理器一致的图标名链，例如 text-plain、text-x-generic、image-png。
pub fn icon_names(path: &Path) -> Vec<String> {
    let Some(path) = c_path(path) else { return Vec::new() };
    let attributes = CString::new("standard::icon").unwrap();
    let mut error = ptr::null_mut();

    // SAFETY: 参数均由本函数持有；返回对象在使用完立即释放
    unsafe {
        let file = g_file_new_for_path(path.as_ptr());
        if file.is_null() {
            return Vec::new();
        }
        let info = g_file_query_info(file, attributes.as_ptr(), 0, ptr::null_mut(), &mut error);
        if info.is_null() {
            free_error(error);
            g_object_unref(file);
            return Vec::new();
        }

        let mut names = Vec::new();
        let icon = g_file_info_get_icon(info);
        if !icon.is_null() {
            let list = g_themed_icon_get_names(icon);
            if !list.is_null() {
                let mut cursor = list;
                while !(*cursor).is_null() {
                    let name = CStr::from_ptr(*cursor).to_string_lossy();
                    if !name.is_empty() && !name.ends_with("-symbolic") {
                        names.push(name.into_owned());
                    }
                    cursor = cursor.add(1);
                }
            }
        }

        g_object_unref(info);
        g_object_unref(file);
        names
    }
}

/// 当前图标主题名；GNOME 读 GSettings，其余桌面靠配置文件。
pub fn theme_name() -> Option<String> {
    let schema = CString::new("org.gnome.desktop.interface").ok()?;
    let key = CString::new("icon-theme").ok()?;
    // SAFETY: 返回对象与字符串均由本函数释放
    unsafe {
        let settings = g_settings_new(schema.as_ptr());
        if settings.is_null() {
            return None;
        }
        let value = take_string(g_settings_get_string(settings, key.as_ptr()));
        g_object_unref(settings);
        value
    }
}

/// 用户显式选过的图标主题；未设置时返回 None，交由系统默认决定
pub fn theme_name_user() -> Option<String> {
    let schema = CString::new("org.gnome.desktop.interface").ok()?;
    let key = CString::new("icon-theme").ok()?;
    // SAFETY: 返回对象与字符串均由本函数释放
    unsafe {
        let settings = g_settings_new(schema.as_ptr());
        if settings.is_null() {
            return None;
        }
        let value = g_settings_get_user_value(settings, key.as_ptr());
        let name = if value.is_null() {
            None
        } else {
            let text = g_variant_get_string(value, ptr::null_mut());
            let name = if text.is_null() {
                None
            } else {
                let name = CStr::from_ptr(text).to_string_lossy().into_owned();
                (!name.is_empty()).then_some(name)
            };
            g_variant_unref(value);
            name
        };
        g_object_unref(settings);
        name
    }
}

/// 把图标文件光栅化成给定边长的 RGBA 直通像素，保持宽高比。
pub fn rasterize(file: &Path, size: u32) -> Option<(u32, u32, Vec<u8>)> {
    let path = c_path(file)?;
    let mut error = ptr::null_mut();
    // SAFETY: 路径与错误指针有效；像素在释放 pixbuf 前拷出
    unsafe {
        let pixbuf =
            gdk_pixbuf_new_from_file_at_scale(path.as_ptr(), size as i32, size as i32, 1, &mut error);
        if pixbuf.is_null() {
            free_error(error);
            return None;
        }

        let width = gdk_pixbuf_get_width(pixbuf);
        let height = gdk_pixbuf_get_height(pixbuf);
        let channels = gdk_pixbuf_get_n_channels(pixbuf);
        let stride = gdk_pixbuf_get_rowstride(pixbuf);
        let alpha = gdk_pixbuf_get_has_alpha(pixbuf) != 0;
        if width <= 0 || height <= 0 || channels < 3 || (channels != 3 && channels != 4) {
            g_object_unref(pixbuf);
            return None;
        }

        let pixels = gdk_pixbuf_get_pixels(pixbuf);
        let (width, height, stride) = (width as usize, height as usize, stride as usize);
        let mut rgba = Vec::with_capacity(width * height * 4);
        for row in 0..height {
            let line = pixels.add(row * stride);
            for column in 0..width {
                let pixel = line.add(column * channels as usize);
                rgba.push(*pixel);
                rgba.push(*pixel.add(1));
                rgba.push(*pixel.add(2));
                rgba.push(if alpha { *pixel.add(3) } else { 255 });
            }
        }
        g_object_unref(pixbuf);
        Some((width as u32, height as u32, rgba))
    }
}
