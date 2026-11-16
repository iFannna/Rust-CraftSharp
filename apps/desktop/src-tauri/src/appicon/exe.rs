//! 运行中 exe 的图标资源替换：改副本，换名，再把副本放回原路径。

use std::ffi::c_void;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use super::ico::{self, Entry};

type Handle = isize;

const RT_ICON: usize = 3;
const RT_GROUP_ICON: usize = 14;
const APP_ICON_ID: usize = 32512;
const LANG_EN_US: u16 = 0x0409;
const LOAD_LIBRARY_AS_DATAFILE: u32 = 0x2;

#[derive(Debug)]
pub enum PatchError {
    /// 目录或文件不可写，需要提权
    Permission,
    Failed(String),
}

impl std::fmt::Display for PatchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PatchError::Permission => formatter.write_str("需要管理员权限才能修改程序文件"),
            PatchError::Failed(message) => formatter.write_str(message),
        }
    }
}

#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryExW(file: *const u16, file_handle: Handle, flags: u32) -> Handle;
    fn FreeLibrary(module: Handle) -> i32;
    fn EnumResourceNamesW(
        module: Handle,
        kind: *const u16,
        callback: Option<
            unsafe extern "system" fn(Handle, *const u16, *const u16, isize) -> i32,
        >,
        param: isize,
    ) -> i32;
    fn EnumResourceLanguagesW(
        module: Handle,
        kind: *const u16,
        name: *const u16,
        callback: Option<
            unsafe extern "system" fn(Handle, *const u16, *const u16, u16, isize) -> i32,
        >,
        param: isize,
    ) -> i32;
    fn BeginUpdateResourceW(file: *const u16, delete_existing: i32) -> Handle;
    fn UpdateResourceW(
        update: Handle,
        kind: *const u16,
        name: *const u16,
        language: u16,
        data: *const c_void,
        size: u32,
    ) -> i32;
    fn EndUpdateResourceW(update: Handle, discard: i32) -> i32;
}

struct Found {
    kind: usize,
    name: usize,
    language: u16,
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

unsafe extern "system" fn collect_name(
    module: Handle,
    kind: *const u16,
    name: *const u16,
    param: isize,
) -> i32 {
    let found = &mut *(param as *mut Vec<Found>);
    let name_id = name as usize;
    // 图标资源使用整数 ID；字符串名不参与替换
    if name_id > u16::MAX as usize {
        return 1;
    }
    let mut languages: Vec<u16> = Vec::new();
    EnumResourceLanguagesW(
        module,
        kind,
        name,
        Some(collect_language),
        &mut languages as *mut Vec<u16> as isize,
    );
    for language in languages {
        found.push(Found {
            kind: kind as usize,
            name: name_id,
            language,
        });
    }
    1
}

unsafe extern "system" fn collect_language(
    _module: Handle,
    _kind: *const u16,
    _name: *const u16,
    language: u16,
    param: isize,
) -> i32 {
    (*(param as *mut Vec<u16>)).push(language);
    1
}

fn existing_resources(path: &Path) -> Result<Vec<Found>, String> {
    let wide_path = wide(path);
    let module = unsafe { LoadLibraryExW(wide_path.as_ptr(), 0, LOAD_LIBRARY_AS_DATAFILE) };
    if module == 0 {
        return Err(format!("无法读取程序文件：{}", io::Error::last_os_error()));
    }

    let mut found = Vec::new();
    for kind in [RT_ICON, RT_GROUP_ICON] {
        unsafe {
            EnumResourceNamesW(
                module,
                kind as usize as *const u16,
                Some(collect_name),
                &mut found as *mut Vec<Found> as isize,
            );
        }
    }
    unsafe {
        FreeLibrary(module);
    }
    Ok(found)
}

fn patch_file(path: &Path, entries: &[Entry]) -> Result<(), String> {
    let found = existing_resources(path)?;
    let wide_path = wide(path);
    let update = unsafe { BeginUpdateResourceW(wide_path.as_ptr(), 0) };
    if update == 0 {
        return Err(format!("无法打开程序文件：{}", io::Error::last_os_error()));
    }

    let write = |kind: usize, id: usize, data: &[u8]| -> bool {
        let pointer = if data.is_empty() {
            std::ptr::null()
        } else {
            data.as_ptr() as *const c_void
        };
        unsafe {
            UpdateResourceW(
                update,
                kind as usize as *const u16,
                id as usize as *const u16,
                LANG_EN_US,
                pointer,
                data.len() as u32,
            ) != 0
        }
    };

    // 删除旧图标资源，避免多套语言或残留 ID 与新图标并存
    for item in &found {
        unsafe {
            UpdateResourceW(
                update,
                item.kind as *const u16,
                item.name as *const u16,
                item.language,
                std::ptr::null(),
                0,
            );
        }
    }

    for (index, entry) in entries.iter().enumerate() {
        if !write(RT_ICON, index + 1, &entry.data) {
            unsafe {
                EndUpdateResourceW(update, 1);
            }
            return Err("写入图标资源失败".into());
        }
    }

    let group = ico::group(entries);
    if !write(RT_GROUP_ICON, APP_ICON_ID, &group) {
        unsafe {
            EndUpdateResourceW(update, 1);
        }
        return Err("写入图标组失败".into());
    }

    if unsafe { EndUpdateResourceW(update, 0) } == 0 {
        return Err(format!("保存程序文件失败：{}", io::Error::last_os_error()));
    }
    Ok(())
}

fn permission(error: &io::Error) -> PatchError {
    if error.kind() == io::ErrorKind::PermissionDenied || error.raw_os_error() == Some(5) {
        PatchError::Permission
    } else {
        PatchError::Failed(error.to_string())
    }
}

fn backup_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "CraftSharp.exe".into());
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    for index in 0..10 {
        let suffix = if index == 0 { ".old".to_string() } else { format!(".old{index}") };
        let candidate = parent.join(format!("{name}{suffix}"));
        if !candidate.exists() || std::fs::remove_file(&candidate).is_ok() {
            return candidate;
        }
    }
    parent.join(format!("{name}.old"))
}

/// 替换程序文件里的图标；失败时保留原文件
pub fn replace(target: &Path, entries: &[Entry]) -> Result<(), PatchError> {
    let parent = target.parent().ok_or_else(|| PatchError::Failed("程序目录无效".into()))?;
    let name = target.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
    let temp = parent.join(format!("{name}.icon-new"));
    let backup = backup_path(target);

    let _ = std::fs::remove_file(&temp);
    std::fs::copy(target, &temp).map_err(|error| permission(&error))?;
    if let Err(message) = patch_file(&temp, entries) {
        let _ = std::fs::remove_file(&temp);
        return Err(PatchError::Failed(message));
    }

    std::fs::rename(target, &backup).map_err(|error| permission(&error))?;
    if let Err(error) = std::fs::rename(&temp, target) {
        let _ = std::fs::rename(&backup, target);
        let _ = std::fs::remove_file(&temp);
        return Err(permission(&error));
    }
    // 当前进程仍从备份文件运行，删除失败时留到下次启动清理
    let _ = std::fs::remove_file(&backup);
    Ok(())
}

/// 清理上次替换留下的备份与临时文件
pub fn cleanup(target: &Path) {
    let Some(parent) = target.parent() else { return };
    let Some(name) = target.file_name().map(|name| name.to_string_lossy().to_string()) else { return };
    let Ok(entries) = std::fs::read_dir(parent) else { return };
    for entry in entries.flatten() {
        let file = entry.file_name().to_string_lossy().to_string();
        if file.starts_with(&format!("{name}.old")) || file == format!("{name}.icon-new") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[link(name = "kernel32")]
    extern "system" {
        fn FindResourceW(module: Handle, name: *const u16, kind: *const u16) -> Handle;
        fn SizeofResource(module: Handle, resource: Handle) -> u32;
        fn LoadResource(module: Handle, resource: Handle) -> Handle;
        fn LockResource(resource: Handle) -> *mut c_void;
    }

    fn group_bytes(path: &Path) -> Vec<u8> {
        let wide_path = wide(path);
        let module = unsafe { LoadLibraryExW(wide_path.as_ptr(), 0, LOAD_LIBRARY_AS_DATAFILE) };
        assert_ne!(module, 0);
        let resource = unsafe {
            FindResourceW(
                module,
                APP_ICON_ID as usize as *const u16,
                RT_GROUP_ICON as usize as *const u16,
            )
        };
        assert_ne!(resource, 0);
        let size = unsafe { SizeofResource(module, resource) } as usize;
        let loaded = unsafe { LoadResource(module, resource) };
        let pointer = unsafe { LockResource(loaded) };
        let bytes = unsafe { std::slice::from_raw_parts(pointer as *const u8, size) }.to_vec();
        unsafe {
            FreeLibrary(module);
        }
        bytes
    }

    #[test]
    fn replaces_icon_resources() {
        let exe = std::env::current_exe().unwrap();
        let temp = std::env::temp_dir().join(format!("craftsharp-icon-test-{}.exe", std::process::id()));
        std::fs::copy(&exe, &temp).unwrap();

        let source = image::RgbaImage::from_pixel(16, 16, image::Rgba([210, 40, 40, 255]));
        let entries = ico::entries(&source).unwrap();
        replace(&temp, &entries).unwrap();

        let found = existing_resources(&temp).unwrap();
        let icons = found.iter().filter(|item| item.kind == RT_ICON).count();
        let groups = found.iter().filter(|item| item.kind == RT_GROUP_ICON).count();
        assert_eq!(icons, entries.len());
        assert_eq!(groups, 1);

        let group = group_bytes(&temp);
        assert_eq!(u16::from_le_bytes([group[2], group[3]]), 1);
        assert_eq!(u16::from_le_bytes([group[4], group[5]]) as usize, entries.len());
        assert_eq!(group[6], 16);
        assert_eq!(group[6 + 14 * (entries.len() - 1)], 0);

        cleanup(&temp);
        let _ = std::fs::remove_file(&temp);
    }
}
