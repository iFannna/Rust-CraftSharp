//! 开机自启：Windows 写 HKCU Run，Linux 写 XDG autostart 入口。

#![allow(non_snake_case)]

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as isize;
    const KEY_SET_VALUE: u32 = 0x0002;
    const REG_SZ: u32 = 1;
    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const VALUE_NAME: &str = "CraftSharp";

    #[link(name = "advapi32")]
    extern "system" {
        fn RegCreateKeyExW(
            root: isize,
            sub_key: *const u16,
            reserved: u32,
            class: *const u16,
            options: u32,
            access: u32,
            security: *const c_void,
            result: *mut isize,
            disposition: *mut u32,
        ) -> i32;
        fn RegSetValueExW(key: isize, name: *const u16, reserved: u32, kind: u32, data: *const u8, len: u32) -> i32;
        fn RegDeleteValueW(key: isize, name: *const u16) -> i32;
        fn RegCloseKey(key: isize) -> i32;
    }

    fn wide(value: &str) -> Vec<u16> {
        Path::new(value).as_os_str().encode_wide().chain(std::iter::once(0)).collect()
    }

    fn open_run_key() -> Result<isize, String> {
        let sub_key = wide(RUN_KEY);
        let mut key = 0isize;
        let mut disposition = 0u32;
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                sub_key.as_ptr(),
                0,
                std::ptr::null(),
                0,
                KEY_SET_VALUE,
                std::ptr::null(),
                &mut key,
                &mut disposition,
            )
        };
        if status == 0 {
            Ok(key)
        } else {
            Err(format!("打开启动项注册表失败：{status}"))
        }
    }

    pub fn set(enabled: bool, _open_settings: bool) -> Result<(), String> {
        let key = open_run_key()?;
        let name = wide(VALUE_NAME);
        let status = unsafe {
            if enabled {
                let exe = std::env::current_exe().map_err(|error| error.to_string())?;
                let command = format!("\"{}\"", exe.display());
                let data: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
                RegSetValueExW(
                    key,
                    name.as_ptr(),
                    0,
                    REG_SZ,
                    data.as_ptr() as *const u8,
                    (data.len() * 2) as u32,
                )
            } else {
                RegDeleteValueW(key, name.as_ptr())
            }
        };
        unsafe {
            RegCloseKey(key);
        }

        // 删除不存在的值会返回 ERROR_FILE_NOT_FOUND，视为已关闭
        if status == 0 || (!enabled && status == 2) {
            Ok(())
        } else {
            Err(format!("写入启动项失败：{status}"))
        }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::path::PathBuf;

    /// 登录自启统一用 XDG 入口，跟随用户配置目录
    fn entry_path() -> PathBuf {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .unwrap_or_else(|| PathBuf::from(".config"));
        base.join("autostart").join("craftsharp.desktop")
    }

    pub fn set(enabled: bool, open_settings: bool) -> Result<(), String> {
        let path = entry_path();
        if !enabled {
            return match std::fs::remove_file(&path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!("移除开机自启失败：{error}")),
            };
        }

        let exe = std::env::current_exe().map_err(|error| error.to_string())?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|error| format!("创建自启目录失败：{error}"))?;
        }
        // 登录启动时先只拉起 HUD；勾了默认打开面板才顺带显示设置
        let args = if open_settings {
            "--autostart --open"
        } else {
            "--autostart"
        };
        let entry = format!(
            "[Desktop Entry]\nType=Application\nName=CraftSharp\nComment=CraftSharp 桌面 HUD\nExec=\"{}\" {args}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
            exe.display()
        );
        std::fs::write(&path, entry).map_err(|error| format!("写入开机自启失败：{error}"))
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod imp {
    pub fn set(_enabled: bool, _open_settings: bool) -> Result<(), String> {
        Err("当前平台未实现".into())
    }
}

pub fn set(enabled: bool, open_settings: bool) -> Result<(), String> {
    imp::set(enabled, open_settings)
}
