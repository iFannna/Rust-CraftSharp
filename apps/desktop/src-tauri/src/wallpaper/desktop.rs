//! 静态壁纸应用：IDesktopWallpaper 按屏设置，Fill 位置写注册表，失败降级 SPI。

use std::path::Path;

#[cfg(windows)]
pub fn apply(path: &Path) -> Result<(), String> {
    ensure_fill();
    if set_for_monitors(path) {
        return Ok(());
    }
    if set_global(path) {
        Ok(())
    } else {
        Err("设置壁纸失败".into())
    }
}

#[cfg(not(windows))]
pub fn apply(_path: &Path) -> Result<(), String> {
    Err("当前平台未实现".into())
}

#[cfg(windows)]
fn ensure_fill() {
    use std::os::windows::ffi::OsStrExt;

    const HKEY_CURRENT_USER: isize = 0x8000_0001;
    const KEY_SET_VALUE: u32 = 0x0002;
    const REG_SZ: u32 = 1;

    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(
            key: isize,
            sub_key: *const u16,
            options: u32,
            desired: u32,
            result: *mut isize,
        ) -> i32;
        fn RegSetValueExW(
            key: isize,
            name: *const u16,
            reserved: u32,
            kind: u32,
            data: *const u8,
            len: u32,
        ) -> i32;
        fn RegCloseKey(key: isize) -> i32;
    }

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    // SAFETY: 只写当前用户 Control Panel\Desktop 的两个字符串值；
    // Win11 上 SetPosition 返回 S_OK 却会异步改回 Fit，显示位置只能靠注册表维护
    unsafe {
        let sub_key = wide(r"Control Panel\Desktop");
        let mut key: isize = 0;
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            sub_key.as_ptr(),
            0,
            KEY_SET_VALUE,
            &mut key,
        ) != 0
        {
            return;
        }
        for (name, value) in [("WallpaperStyle", "10"), ("TileWallpaper", "0")] {
            let name = wide(name);
            let value = wide(value);
            RegSetValueExW(
                key,
                name.as_ptr(),
                0,
                REG_SZ,
                value.as_ptr() as *const u8,
                (value.len() * 2) as u32,
            );
        }
        RegCloseKey(key);
    }
}

#[cfg(windows)]
#[repr(C)]
struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

#[cfg(windows)]
const fn guid(data1: u32, data2: u16, data3: u16, data4: [u8; 8]) -> Guid {
    Guid {
        data1,
        data2,
        data3,
        data4,
    }
}

#[cfg(windows)]
fn set_for_monitors(path: &Path) -> bool {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    const CLSCTX_INPROC_SERVER: u32 = 1;
    const COINIT_APARTMENTTHREADED: u32 = 0x2;

    static CLSID_DESKTOP_WALLPAPER: Guid = guid(
        0xC2CF_3110,
        0x460E,
        0x4FC1,
        [0xB9, 0xD0, 0x8A, 0x1C, 0x0C, 0x9C, 0xC4, 0xBD],
    );
    static IID_DESKTOP_WALLPAPER: Guid = guid(
        0xB92B_56A9,
        0x8B55,
        0x4E14,
        [0x9A, 0x89, 0x01, 0x99, 0xBB, 0xB6, 0xF9, 0x3B],
    );

    #[repr(C)]
    struct Vtbl {
        query_interface: usize,
        add_ref: usize,
        release: unsafe extern "system" fn(*mut c_void) -> u32,
        set_wallpaper: unsafe extern "system" fn(*mut c_void, *const u16, *const u16) -> i32,
        get_wallpaper: usize,
        monitor_path_at: unsafe extern "system" fn(*mut c_void, u32, *mut *mut u16) -> i32,
        monitor_path_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
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
        fn CoTaskMemFree(pointer: *mut c_void);
    }

    fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }

    // SAFETY: COM 在 APARTMENTTHREADED 下初始化，接口指针与显示器路径字符串按约定释放
    unsafe {
        let hr = CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED);
        let initialized = hr >= 0;

        let mut wallpaper: *mut c_void = std::ptr::null_mut();
        let created = CoCreateInstance(
            &CLSID_DESKTOP_WALLPAPER,
            std::ptr::null_mut(),
            CLSCTX_INPROC_SERVER,
            &IID_DESKTOP_WALLPAPER,
            &mut wallpaper,
        ) >= 0
            && !wallpaper.is_null();

        let mut applied = 0u32;
        if created {
            let vtbl = *(wallpaper as *mut *const Vtbl);
            let mut count = 0u32;
            if ((*vtbl).monitor_path_count)(wallpaper, &mut count) >= 0 {
                let path = wide(path.as_os_str());
                for index in 0..count {
                    let mut monitor: *mut u16 = std::ptr::null_mut();
                    if ((*vtbl).monitor_path_at)(wallpaper, index, &mut monitor) < 0
                        || monitor.is_null()
                    {
                        continue;
                    }
                    if ((*vtbl).set_wallpaper)(wallpaper, monitor, path.as_ptr()) >= 0 {
                        applied += 1;
                    }
                    CoTaskMemFree(monitor as *mut c_void);
                }
            }
            ((*vtbl).release)(wallpaper);
        }

        if initialized {
            CoUninitialize();
        }
        applied > 0
    }
}

#[cfg(windows)]
fn set_global(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;

    const SPI_SETDESKWALLPAPER: u32 = 0x0014;
    const SPIF_UPDATEINIFILE: u32 = 0x01;
    const SPIF_SENDWININICHANGE: u32 = 0x02;

    #[link(name = "user32")]
    extern "system" {
        fn SystemParametersInfoW(
            action: u32,
            param: u32,
            value: *mut std::ffi::c_void,
            flags: u32,
        ) -> i32;
    }

    let path: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: 传入以 NUL 结尾的路径，系统只读取
    unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            path.as_ptr() as *mut std::ffi::c_void,
            SPIF_UPDATEINIFILE | SPIF_SENDWININICHANGE,
        ) != 0
    }
}
