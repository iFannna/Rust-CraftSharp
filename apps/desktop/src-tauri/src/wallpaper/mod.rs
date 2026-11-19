//! 壁纸：列表、登录、静态/动态应用、多屏与拼接编排。

mod auth;
mod client;
mod desktop;
mod dialog;
mod dynamic;
pub(crate) mod layout;
mod storage;
mod store;

use tauri::{AppHandle, Manager};

pub use client::Page;
pub use desktop::MonitorInfo;
pub use layout::ApplyResult;

pub fn init(app: &AppHandle) {
    storage::init(app);
    auth::load(app);
    dynamic::restore(app);
}

pub fn list(page: u32, kind: &str, sort: &str) -> Result<Page, String> {
    client::list(page, kind, sort)
}

pub fn monitors() -> Vec<MonitorInfo> {
    desktop::monitors()
}

pub fn apply_plan(app: &AppHandle, plan: layout::Plan) -> Result<ApplyResult, String> {
    layout::apply(app, plan)
}

pub fn export(id: &str, path: &str) -> Result<(), String> {
    store::export(id, path)
}

pub fn session() -> bool {
    auth::logged_in()
}

pub fn logout(app: &AppHandle) {
    auth::clear(app);
}

pub fn storage_path(app: &AppHandle) -> String {
    storage::current(app)
}

pub fn migrate_storage(app: &AppHandle, target: &str) -> Result<String, String> {
    storage::migrate(app, target)
}

pub fn reset_storage(app: &AppHandle) -> Result<String, String> {
    storage::reset(app)
}

pub fn open_storage(app: &AppHandle) -> Result<(), String> {
    storage::open(app)
}

/// 以设置窗口为 owner 打开另存为对话框，必须在主线程调用
pub fn pick(app: &AppHandle, title: &str) -> Option<String> {
    dialog::pick(title, owner(app))
}

/// 选择文件夹，必须在主线程调用
pub fn pick_folder(app: &AppHandle, title: &str) -> Option<String> {
    dialog::pick_folder(title, owner(app))
}

fn owner(app: &AppHandle) -> isize {
    app.get_webview_window("settings")
        .and_then(|window| window.hwnd().ok())
        .map(|handle| handle.0 as isize)
        .unwrap_or(0)
}

/// 从登录窗口读取会话 Cookie，成功后关闭窗口并发事件
pub fn capture_session(app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let window = app
            .get_webview_window("wallpaper-login")
            .ok_or_else(|| "登录窗口未打开".to_string())?;
        let handle = app.clone();
        window
            .with_webview(move |webview| {
                cookie::capture(&handle, &webview.controller());
            })
            .map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("当前平台未实现".into())
    }
}

#[cfg(windows)]
mod cookie {
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::GetCookiesCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows_core::{Interface, HSTRING};

    use super::auth;

    pub fn capture(app: &AppHandle, controller: &ICoreWebView2Controller) {
        let handle = app.clone();
        // SAFETY: WebView2 接口在窗口存活期间有效，回调由 WebView2 消息循环驱动
        unsafe {
            let Ok(core) = controller.CoreWebView2() else {
                return;
            };
            let Ok(core13) = core.cast::<ICoreWebView2_13>() else {
                return;
            };
            let Ok(profile) = core13.Profile() else {
                return;
            };
            let Ok(profile5) = profile.cast::<ICoreWebView2Profile5>() else {
                return;
            };
            let Ok(manager) = profile5.CookieManager() else {
                return;
            };
            let uri = HSTRING::from("https://mcblock.top");
            let handler = GetCookiesCompletedHandler::create(Box::new(move |_result, list| {
                let session = list.and_then(read_session);
                let ok = session
                    .as_deref()
                    .is_some_and(|value| auth::save(&handle, value).is_ok());
                let _ = handle.emit("wallpaper:session", ok);
                if ok {
                    if let Some(window) = handle.get_webview_window("wallpaper-login") {
                        let _ = window.close();
                    }
                }
                Ok(())
            }));
            let _ = manager.GetCookies(&uri, &handler);
        }
    }

    fn read_session(list: ICoreWebView2CookieList) -> Option<String> {
        let mut count = 0u32;
        // SAFETY: 只读取 WebView2 返回的 Cookie 列表
        unsafe {
            list.Count(&mut count).ok()?;
        }
        let mut parts = Vec::new();
        for index in 0..count {
            let Ok(cookie) = (unsafe { list.GetValueAtIndex(index) }) else {
                continue;
            };
            let mut name = windows_core::PWSTR::null();
            let mut value = windows_core::PWSTR::null();
            // SAFETY: 输出指针由 WebView2 分配，复制后立即释放
            unsafe {
                if cookie.Name(&mut name).is_err() || cookie.Value(&mut value).is_err() {
                    continue;
                }
            }
            let name = take_pwstr(name);
            let value = take_pwstr(value);
            // NextAuth 的会话可能按大小拆成 .0/.1 多段，全部保留
            if name.to_ascii_lowercase().contains("session-token") {
                parts.push(format!("{name}={value}"));
            }
        }
        if parts.is_empty() {
            None
        } else {
            Some(parts.join("; "))
        }
    }

    fn take_pwstr(pointer: windows_core::PWSTR) -> String {
        if pointer.is_null() {
            return String::new();
        }
        let text = unsafe {
            let mut len = 0;
            while *pointer.0.add(len) != 0 {
                len += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(pointer.0, len))
        };
        // SAFETY: WebView2 使用 CoTaskMemAlloc 分配字符串
        unsafe {
            #[link(name = "ole32")]
            extern "system" {
                fn CoTaskMemFree(pointer: *mut std::ffi::c_void);
            }
            CoTaskMemFree(pointer.0 as *mut std::ffi::c_void);
        }
        text
    }
}
