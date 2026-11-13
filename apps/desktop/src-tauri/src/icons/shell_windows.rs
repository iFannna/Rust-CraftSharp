#![allow(non_snake_case, non_camel_case_types, clippy::upper_case_acronyms)]

//! Windows Shell 图标与快捷方式解析。
//! 取值方式与原 WPF 实现一致：SHGetFileInfoW + SHGFI_ICON + SHGFI_LARGEICON + SHGFI_USEFILEATTRIBUTES，
//! 实测与不带 USEFILEATTRIBUTES 的结果相同，.lnk 得到带角标的快捷方式图标。

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

type Hicon = isize;
type Hbitmap = isize;
type Hdc = isize;

const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
const FILE_ATTRIBUTE_NORMAL: u32 = 0x0000_0080;
const SHGFI_ICON: u32 = 0x0000_0100;
const SHGFI_LARGEICON: u32 = 0x0000_0000;
const SHGFI_USEFILEATTRIBUTES: u32 = 0x0000_0010;
const DIB_RGB_COLORS: u32 = 0;
const BI_RGB: u32 = 0;
const CLSCTX_INPROC_SERVER: u32 = 1;
const STGM_READ: u32 = 0;
const SLGP_RAWPATH: u32 = 4;
const COINIT_APARTMENTTHREADED: u32 = 0x2;

#[repr(C)]
struct ShFileInfoW {
    h_icon: Hicon,
    i_icon: i32,
    dw_attributes: u32,
    sz_display_name: [u16; 260],
    sz_type_name: [u16; 80],
}

#[repr(C)]
struct IconInfo {
    f_icon: i32,
    x_hotspot: u32,
    y_hotspot: u32,
    hbm_mask: Hbitmap,
    hbm_color: Hbitmap,
}

#[repr(C)]
struct Bitmap {
    bm_type: i32,
    bm_width: i32,
    bm_height: i32,
    bm_width_bytes: i32,
    bm_planes: u16,
    bm_bits_pixel: u16,
    bm_bits: *mut c_void,
}

#[repr(C)]
struct BitmapInfoHeader {
    bi_size: u32,
    bi_width: i32,
    bi_height: i32,
    bi_planes: u16,
    bi_bit_count: u16,
    bi_compression: u32,
    bi_size_image: u32,
    bi_x_pels_per_meter: i32,
    bi_y_pels_per_meter: i32,
    bi_clr_used: u32,
    bi_clr_important: u32,
}

#[repr(C)]
struct BitmapInfo {
    header: BitmapInfoHeader,
    colors: [u32; 3],
}

#[repr(C)]
struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

const fn guid(data1: u32, data2: u16, data3: u16, data4: [u8; 8]) -> Guid {
    Guid { data1, data2, data3, data4 }
}

static CLSID_SHELL_LINK: Guid = guid(0x0002_1401, 0, 0, [0xC0, 0, 0, 0, 0, 0, 0, 0x46]);
static IID_ISHELL_LINK_W: Guid = guid(0x0002_14F9, 0, 0, [0xC0, 0, 0, 0, 0, 0, 0, 0x46]);
static IID_IPERSIST_FILE: Guid = guid(0x0000_010B, 0, 0, [0xC0, 0, 0, 0, 0, 0, 0, 0x46]);

#[repr(C)]
struct IShellLinkWVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    get_path: unsafe extern "system" fn(*mut c_void, *mut u16, i32, *mut c_void, u32) -> i32,
    get_id_list: usize,
    set_id_list: usize,
    get_description: usize,
    set_description: usize,
    get_working_directory: usize,
    set_working_directory: usize,
    get_arguments: usize,
    set_arguments: usize,
    get_hotkey: usize,
    set_hotkey: usize,
    get_show_cmd: usize,
    set_show_cmd: usize,
    get_icon_location: usize,
    set_icon_location: usize,
    set_relative_path: usize,
    resolve: unsafe extern "system" fn(*mut c_void, isize, u32) -> i32,
    set_path: usize,
}

#[repr(C)]
struct IPersistFileVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    get_class_id: usize,
    is_dirty: usize,
    load: unsafe extern "system" fn(*mut c_void, *const u16, u32) -> i32,
}

#[link(name = "shell32")]
extern "system" {
    fn SHGetFileInfoW(
        psz_path: *const u16,
        dw_file_attributes: u32,
        psfi: *mut ShFileInfoW,
        cb_file_info: u32,
        u_flags: u32,
    ) -> usize;
}

#[link(name = "user32")]
extern "system" {
    fn DestroyIcon(icon: Hicon) -> i32;
    fn GetDC(hwnd: isize) -> Hdc;
    fn ReleaseDC(hwnd: isize, hdc: Hdc) -> i32;
    fn GetIconInfo(icon: Hicon, info: *mut IconInfo) -> i32;
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateCompatibleDC(hdc: Hdc) -> Hdc;
    fn DeleteDC(hdc: Hdc) -> i32;
    fn DeleteObject(object: isize) -> i32;
    fn GetObjectW(object: isize, size: i32, buffer: *mut c_void) -> i32;
    fn GetDIBits(
        hdc: Hdc,
        bitmap: Hbitmap,
        start: u32,
        lines: u32,
        bits: *mut c_void,
        info: *mut c_void,
        usage: u32,
    ) -> i32;
}

#[link(name = "ole32")]
extern "system" {
    fn CoInitializeEx(reserved: *mut c_void, coinit: u32) -> i32;
    fn CoUninitialize();
    fn CoCreateInstance(
        clsid: *const Guid,
        outer: *mut c_void,
        clsctx: u32,
        iid: *const Guid,
        out: *mut *mut c_void,
    ) -> i32;
}

fn wide(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// 取文件或目录的大图标，返回 RGBA 像素。
pub fn icon_rgba(path: &str) -> Option<(u32, u32, Vec<u8>)> {
    let wide_path = wide(path);
    let attributes = if Path::new(path).is_dir() {
        FILE_ATTRIBUTE_DIRECTORY
    } else {
        FILE_ATTRIBUTE_NORMAL
    };

    let mut info: ShFileInfoW = unsafe { std::mem::zeroed() };
    let flags = SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES;
    let result = unsafe {
        SHGetFileInfoW(
            wide_path.as_ptr(),
            attributes,
            &mut info,
            std::mem::size_of::<ShFileInfoW>() as u32,
            flags,
        )
    };

    if result == 0 || info.h_icon == 0 {
        return None;
    }

    let pixels = unsafe { hicon_to_rgba(info.h_icon) };
    unsafe {
        DestroyIcon(info.h_icon);
    }
    pixels
}

unsafe fn hicon_to_rgba(icon: Hicon) -> Option<(u32, u32, Vec<u8>)> {
    let mut info: IconInfo = std::mem::zeroed();
    if GetIconInfo(icon, &mut info) == 0 {
        return None;
    }

    let color = info.hbm_color;
    let mask = info.hbm_mask;
    let pixels = read_color(color, mask);

    if color != 0 {
        DeleteObject(color);
    }
    if mask != 0 {
        DeleteObject(mask);
    }

    pixels
}

unsafe fn read_color(color: Hbitmap, mask: Hbitmap) -> Option<(u32, u32, Vec<u8>)> {
    if color == 0 {
        return None;
    }

    let mut bitmap: Bitmap = std::mem::zeroed();
    if GetObjectW(
        color,
        std::mem::size_of::<Bitmap>() as i32,
        &mut bitmap as *mut _ as *mut c_void,
    ) == 0
    {
        return None;
    }

    let width = bitmap.bm_width.max(0) as u32;
    let height = bitmap.bm_height.max(0) as u32;
    if width == 0 || height == 0 || width > 512 || height > 512 {
        return None;
    }

    let mut pixels = read_bits(color, width, height)?;

    // 现代图标带 alpha；老图标 alpha 全 0 时改用掩码，掩码为白色表示透明
    let has_alpha = pixels.chunks_exact(4).any(|pixel| pixel[3] != 0);
    if !has_alpha {
        if let Some(mask_pixels) = read_bits(mask, width, height) {
            for (pixel, mask_pixel) in pixels.chunks_exact_mut(4).zip(mask_pixels.chunks_exact(4)) {
                let transparent = mask_pixel[0] != 0 || mask_pixel[1] != 0 || mask_pixel[2] != 0;
                pixel[3] = if transparent { 0 } else { 255 };
            }
        } else {
            for pixel in pixels.chunks_exact_mut(4) {
                pixel[3] = 255;
            }
        }
    }

    // GetDIBits 输出 BGRA
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    Some((width, height, pixels))
}

unsafe fn read_bits(bitmap: Hbitmap, width: u32, height: u32) -> Option<Vec<u8>> {
    if bitmap == 0 {
        return None;
    }

    let screen = GetDC(0);
    if screen == 0 {
        return None;
    }

    let dc = CreateCompatibleDC(screen);
    if dc == 0 {
        ReleaseDC(0, screen);
        return None;
    }

    let mut info: BitmapInfo = std::mem::zeroed();
    info.header.bi_size = std::mem::size_of::<BitmapInfoHeader>() as u32;
    info.header.bi_width = width as i32;
    // 负高度表示自上而下，避免逐行翻转
    info.header.bi_height = -(height as i32);
    info.header.bi_planes = 1;
    info.header.bi_bit_count = 32;
    info.header.bi_compression = BI_RGB;

    let mut buffer = vec![0u8; width as usize * height as usize * 4];
    let scanned = GetDIBits(
        dc,
        bitmap,
        0,
        height,
        buffer.as_mut_ptr() as *mut c_void,
        &mut info as *mut _ as *mut c_void,
        DIB_RGB_COLORS,
    );

    DeleteDC(dc);
    ReleaseDC(0, screen);

    if scanned == 0 {
        None
    } else {
        Some(buffer)
    }
}

/// 解析 .lnk 的目标路径。
pub fn shortcut_target(path: &str) -> Option<String> {
    unsafe {
        let hr = CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED);
        let initialized = hr >= 0;
        let target = resolve_link(path);
        if initialized {
            CoUninitialize();
        }
        target
    }
}

unsafe fn resolve_link(path: &str) -> Option<String> {
    let mut link: *mut c_void = std::ptr::null_mut();
    let hr = CoCreateInstance(
        &CLSID_SHELL_LINK,
        std::ptr::null_mut(),
        CLSCTX_INPROC_SERVER,
        &IID_ISHELL_LINK_W,
        &mut link,
    );
    if hr < 0 || link.is_null() {
        return None;
    }

    let link_vtbl = *(link as *mut *const IShellLinkWVtbl);
    let mut persist: *mut c_void = std::ptr::null_mut();
    let mut target = None;

    if ((*link_vtbl).query_interface)(link, &IID_IPERSIST_FILE, &mut persist) >= 0 && !persist.is_null() {
        let persist_vtbl = *(persist as *mut *const IPersistFileVtbl);
        let wide_path = wide(path);

        if ((*persist_vtbl).load)(persist, wide_path.as_ptr(), STGM_READ) >= 0 {
            ((*link_vtbl).resolve)(link, 0, 0);

            let mut buffer = [0u16; 260];
            let hr = ((*link_vtbl).get_path)(
                link,
                buffer.as_mut_ptr(),
                buffer.len() as i32,
                std::ptr::null_mut(),
                SLGP_RAWPATH,
            );

            if hr >= 0 {
                let len = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
                if len > 0 {
                    target = Some(String::from_utf16_lossy(&buffer[..len]));
                }
            }
        }

        ((*persist_vtbl).release)(persist);
    }

    ((*link_vtbl).release)(link);
    target
}
