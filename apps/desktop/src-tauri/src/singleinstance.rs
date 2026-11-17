//! 单实例：命名互斥体保证只跑一份，第二次启动时唤醒已有实例打开设置。

#[cfg(windows)]
mod imp {
    use std::thread;

    use tauri::AppHandle;

    // 与旧版 WPF 程序区分身份，两者可同时运行且不会互相唤醒
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
            let event = wide(EVENT_NAME);
            // SAFETY: 打开已有实例创建的事件并置位
            let handle = unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, event.as_ptr()) };
            if handle != 0 {
                unsafe { SetEvent(handle) };
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

#[cfg(not(windows))]
mod imp {
    pub fn acquire() -> bool {
        true
    }

    pub fn watch(_app: tauri::AppHandle) {}
}

pub use imp::{acquire, watch};
