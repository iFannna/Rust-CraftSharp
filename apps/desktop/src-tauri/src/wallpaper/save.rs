//! 原生另存为对话框，保留旧版下载流程，默认保存为 JPEG。

use super::store;

#[cfg(windows)]
pub fn pick(title: &str, owner: isize) -> Option<String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    const OFN_OVERWRITEPROMPT: u32 = 0x0000_0002;
    const OFN_NOCHANGEDIR: u32 = 0x0000_0008;
    const OFN_PATHMUSTEXIST: u32 = 0x0000_0800;

    #[repr(C)]
    struct OpenFileNameW {
        struct_size: u32,
        owner: isize,
        instance: isize,
        filter: *const u16,
        custom_filter: *mut u16,
        max_custom_filter: u32,
        filter_index: u32,
        file: *mut u16,
        max_file: u32,
        file_title: *mut u16,
        max_file_title: u32,
        initial_dir: *const u16,
        title: *const u16,
        flags: u32,
        file_offset: u16,
        file_extension: u16,
        default_ext: *const u16,
        custom_data: isize,
        hook: isize,
        template: *const u16,
        reserved: *mut c_void,
        reserved_u32: u32,
        flags_ex: u32,
    }

    #[link(name = "comdlg32")]
    extern "system" {
        fn GetSaveFileNameW(dialog: *mut OpenFileNameW) -> i32;
    }

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let default_name = format!("{}.jpg", store::safe_name(title));
    let mut buffer = [0u16; 1024];
    for (slot, unit) in buffer.iter_mut().zip(default_name.encode_utf16()) {
        *slot = unit;
    }

    // 文件类型文案不跟随界面语言，避免对话框文案分散在两处
    let filter: Vec<u16> = "JPEG (*.jpg)\0*.jpg\0\0".encode_utf16().collect();
    let ext = wide("jpg");

    let mut dialog = OpenFileNameW {
        struct_size: std::mem::size_of::<OpenFileNameW>() as u32,
        owner,
        instance: 0,
        filter: filter.as_ptr(),
        custom_filter: std::ptr::null_mut(),
        max_custom_filter: 0,
        filter_index: 1,
        file: buffer.as_mut_ptr(),
        max_file: buffer.len() as u32,
        file_title: std::ptr::null_mut(),
        max_file_title: 0,
        initial_dir: std::ptr::null(),
        title: std::ptr::null(),
        flags: OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST,
        file_offset: 0,
        file_extension: 0,
        default_ext: ext.as_ptr(),
        custom_data: 0,
        hook: 0,
        template: std::ptr::null(),
        reserved: std::ptr::null_mut(),
        reserved_u32: 0,
        flags_ex: 0,
    };

    // SAFETY: 结构体字段指向调用栈上的宽字符缓冲区，调用期间一直有效
    let picked = unsafe { GetSaveFileNameW(&mut dialog) } != 0;
    if !picked {
        return None;
    }
    let len = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    if len == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..len]))
}

#[cfg(not(windows))]
pub fn pick(_title: &str, _owner: isize) -> Option<String> {
    None
}
