//! 静态壁纸与显示器枚举：IDesktopWallpaper 按屏设置，Fill 位置写注册表，失败降级 SPI。

use std::path::Path;

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub device_path: String,
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub primary: bool,
}

impl MonitorInfo {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

/// 枚举在场显示器，按左上到右下排序；COM 不可用时返回空列表
pub fn monitors() -> Vec<MonitorInfo> {
    #[cfg(windows)]
    {
        com::Desktop::new()
            .map(|desktop| desktop.monitors())
            .unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// 设置全部显示器为同一张图
pub fn apply(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        ensure_fill();
        if let Some(desktop) = com::Desktop::new() {
            let list = desktop.monitors();
            let mut applied = 0;
            for monitor in &list {
                if desktop.set(&monitor.device_path, path) {
                    applied += 1;
                }
            }
            if applied > 0 {
                return Ok(());
            }
        }
        return if set_global(path) {
            Ok(())
        } else {
            Err("设置壁纸失败".into())
        };
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("当前平台未实现".into())
    }
}

/// 只设置指定显示器，COM 不可用时直接失败，避免误改所有屏幕
pub fn set_for(device_path: &str, path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let Some(desktop) = com::Desktop::new() else {
            return Err("无法访问桌面壁纸接口".into());
        };
        ensure_fill();
        if desktop.set(device_path, path) {
            Ok(())
        } else {
            Err(format!("显示器设置失败：{device_path}"))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (device_path, path);
        Err("当前平台未实现".into())
    }
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

#[cfg(windows)]
mod com {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use super::MonitorInfo;

    // 桌面壁纸类在部分系统由本地服务承载，必须用 CLSCTX_ALL
    const CLSCTX_ALL: u32 = 23;
    const COINIT_APARTMENTTHREADED: u32 = 0x2;

    #[repr(C)]
    struct Guid {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    const fn guid(data1: u32, data2: u16, data3: u16, data4: [u8; 8]) -> Guid {
        Guid {
            data1,
            data2,
            data3,
            data4,
        }
    }

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
    #[derive(Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct Vtbl {
        query_interface: usize,
        add_ref: usize,
        release: unsafe extern "system" fn(*mut c_void) -> u32,
        set_wallpaper: unsafe extern "system" fn(*mut c_void, *const u16, *const u16) -> i32,
        get_wallpaper: usize,
        monitor_path_at: unsafe extern "system" fn(*mut c_void, u32, *mut *mut u16) -> i32,
        monitor_path_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
        monitor_rect: unsafe extern "system" fn(*mut c_void, *const u16, *mut Rect) -> i32,
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

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn read_pwstr(pointer: *mut u16) -> String {
        if pointer.is_null() {
            return String::new();
        }
        // SAFETY: 指针由 COM 返回，以 NUL 结尾
        unsafe {
            let mut len = 0;
            while *pointer.add(len) != 0 {
                len += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(pointer, len))
        }
    }

    pub struct Desktop {
        pointer: *mut c_void,
        vtbl: *const Vtbl,
        initialized: bool,
    }

    impl Desktop {
        pub fn new() -> Option<Self> {
            // SAFETY: 所有接口指针与字符串按 COM 约定在 Drop 中释放
            unsafe {
                let hr = CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED);
                let initialized = hr >= 0;
                let mut pointer: *mut c_void = std::ptr::null_mut();
                let create_hr = CoCreateInstance(
                    &CLSID_DESKTOP_WALLPAPER,
                    std::ptr::null_mut(),
                    CLSCTX_ALL,
                    &IID_DESKTOP_WALLPAPER,
                    &mut pointer,
                );
                let created = create_hr >= 0 && !pointer.is_null();
                if !created {
                    if initialized {
                        CoUninitialize();
                    }
                    return None;
                }
                Some(Self {
                    pointer,
                    vtbl: *(pointer as *mut *const Vtbl),
                    initialized,
                })
            }
        }

        pub fn monitors(&self) -> Vec<MonitorInfo> {
            let mut count = 0u32;
            // SAFETY: 接口在 Desktop 生命周期内有效
            if unsafe { ((*self.vtbl).monitor_path_count)(self.pointer, &mut count) } < 0 {
                return Vec::new();
            }
            let mut list = Vec::new();
            for index in 0..count {
                let mut path: *mut u16 = std::ptr::null_mut();
                if unsafe { ((*self.vtbl).monitor_path_at)(self.pointer, index, &mut path) } < 0
                    || path.is_null()
                {
                    continue;
                }
                let device_path = read_pwstr(path);
                // SAFETY: 路径字符串由 COM 分配
                unsafe { CoTaskMemFree(path as *mut c_void) };
                if device_path.is_empty() {
                    continue;
                }

                let wide_path = wide(&device_path);
                let mut rect = Rect::default();
                if unsafe {
                    ((*self.vtbl).monitor_rect)(self.pointer, wide_path.as_ptr(), &mut rect)
                } < 0
                {
                    continue;
                }
                if rect.left == rect.right || rect.top == rect.bottom {
                    continue;
                }
                let primary = rect.left <= 0 && rect.top <= 0 && rect.right > 0 && rect.bottom > 0;
                list.push(MonitorInfo {
                    device_path,
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    primary,
                });
            }
            list.sort_by_key(|item| (item.left, item.top));
            list
        }

        pub fn set(&self, device_path: &str, path: &Path) -> bool {
            let monitor = wide(device_path);
            let image: Vec<u16> = path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            // SAFETY: 两个字符串都以 NUL 结尾，调用期间有效
            unsafe {
                ((*self.vtbl).set_wallpaper)(self.pointer, monitor.as_ptr(), image.as_ptr()) >= 0
            }
        }
    }

    impl Drop for Desktop {
        fn drop(&mut self) {
            // SAFETY: 接口只释放一次，随后按需反初始化 COM
            unsafe {
                ((*self.vtbl).release)(self.pointer);
                if self.initialized {
                    CoUninitialize();
                }
            }
        }
    }
}
