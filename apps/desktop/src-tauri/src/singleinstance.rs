//! 单实例：命名互斥体保证只跑一份，第二次启动时唤醒已有实例打开设置。

#[cfg(windows)]
mod imp {
    use std::thread;

    use tauri::AppHandle;

    // 独立命名，避免与同机其他版本互相唤醒
    const MUTEX_NAME: &str = "Local\\CraftSharp.Next.SingleInstance";
    const EVENT_NAME: &str = "Local\\CraftSharp.Next.Activate";
    const ERROR_ALREADY_EXISTS: u32 = 183;
    const EVENT_MODIFY_STATE: u32 = 0x0002;
    const WAIT_OBJECT_0: u32 = 0;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(attributes: *const u8, owner: i32, name: *const u16) -> isize;
        fn CreateEventW(attributes: *const u8, manual_reset: i32, initial: i32, name: *const u16) -> isize;
        fn OpenEventW(access: u32, inherit: i32, name: *const u16) -> isize;
        fn SetEvent(event: isize) -> i32;
        fn WaitForSingleObject(handle: isize, milliseconds: u32) -> u32;
        fn GetLastError() -> u32;
        fn CloseHandle(handle: isize) -> i32;
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 返回 true 表示当前进程是首个实例；否则唤醒已有实例后返回 false。
    pub fn acquire() -> bool {
        let name = wide(MUTEX_NAME);
        // SAFETY: 只传入空安全属性与名称指针
        let mutex = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if mutex == 0 {
            return true;
        }

        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            // SAFETY: 已存在实例时关闭本次打开的句柄
            unsafe { CloseHandle(mutex) };
            let event = wide(EVENT_NAME);
            // SAFETY: 打开已有实例创建的事件并置位
            let handle = unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, event.as_ptr()) };
            if handle != 0 {
                unsafe { SetEvent(handle) };
                unsafe { CloseHandle(handle) };
            }
            return false;
        }

        // 互斥体句柄不显式关闭，随进程结束由系统回收
        let _ = mutex;
        true
    }

    /// 首个实例启动后调用，收到第二实例信号时直接显示并聚焦设置面板。
    pub fn watch(app: AppHandle) {
        let name = wide(EVENT_NAME);
        // SAFETY: 自动复位事件，仅首实例创建
        let event = unsafe { CreateEventW(std::ptr::null(), 0, 0, name.as_ptr()) };
        if event == 0 {
            return;
        }

        thread::spawn(move || loop {
            // SAFETY: 阻塞等待事件，自动复位后继续下一轮
            if unsafe { WaitForSingleObject(event, u32::MAX) } != WAIT_OBJECT_0 {
                continue;
            }
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || crate::show_settings(&handle));
        });
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::io::{Read, Write};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::PathBuf;
    use std::sync::OnceLock;

    use tauri::AppHandle;

    /// 在 acquire 阶段就绑定，避免第二个实例落在初始化空档里
    static LISTENER: OnceLock<UnixListener> = OnceLock::new();

    fn socket_path() -> PathBuf {
        let base = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        base.join("craftsharp-desktop.sock")
    }

    pub fn acquire() -> bool {
        let path = socket_path();
        if let Ok(mut stream) = UnixStream::connect(&path) {
            let _ = stream.write_all(b"show");
            return false;
        }
        // 上次退出留下的 socket 无法连接，删除后重建
        let _ = std::fs::remove_file(&path);
        match UnixListener::bind(&path) {
            Ok(listener) => {
                let _ = LISTENER.set(listener);
                true
            }
            Err(_) => true,
        }
    }

    pub fn watch(app: AppHandle) {
        let Some(listener) = LISTENER.get().and_then(|listener| listener.try_clone().ok()) else {
            return;
        };
        let _ = std::thread::Builder::new()
            .name("single-instance".into())
            .spawn(move || {
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else { continue };
                    let mut buffer = [0u8; 8];
                    let _ = stream.read(&mut buffer);
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || crate::show_settings(&handle));
                }
            });
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod imp {
    pub fn acquire() -> bool {
        true
    }

    pub fn watch(_app: tauri::AppHandle) {}
}

pub use imp::{acquire, watch};
