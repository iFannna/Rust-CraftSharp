//! 壁纸：列表、登录、静态/动态应用、多屏与拼接编排。

mod auth;
mod client;
mod desktop;
mod dialog;
mod display;
mod dynamic;
pub(crate) mod layout;
mod storage;
mod store;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

pub use client::Page;
pub use desktop::MonitorInfo;
pub use layout::ApplyResult;

static WATCHING: AtomicBool = AtomicBool::new(false);

pub fn init(app: &AppHandle) {
    storage::init(app);
    auth::load(app);
    dynamic::restore(app);
}

pub fn list(page: u32, kind: &str, sort: &str) -> Result<Page, String> {
    client::list(page, kind, sort)
}

/// 本地协议响应：静态壁纸的无水印缩略图与预览图
pub fn image_response(app: &AppHandle, path: &str) -> tauri::http::Response<Vec<u8>> {
    display::response(app, path)
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
    #[cfg(windows)]
    forget_cookies(app);
    if let Some(window) = app.get_window("wallpaper-login") {
        let _ = window.close();
    }
    let _ = app.emit("wallpaper:session", false);
}

/// 登录窗口打开期间轮询抓取，窗口关闭即结束
pub fn watch_login(app: &AppHandle) {
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        // 窗口由前端异步创建，先等它出现
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        while handle.get_webview("wallpaper-login").is_none() {
            if std::time::Instant::now() > deadline {
                WATCHING.store(false, Ordering::SeqCst);
                return;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        while handle.get_webview("wallpaper-login").is_some() {
            let _ = capture_session(&handle);
            std::thread::sleep(Duration::from_millis(800));
        }
        WATCHING.store(false, Ordering::SeqCst);
    });
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

/// 从登录窗口读取会话 Cookie；登录页轮询调用，未登录时静默返回
pub fn capture_session(app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        // 登录窗口挂着站点子 WebView，按 label 取根 WebView 才拿得到
        for label in ["wallpaper-login-site", "wallpaper-login", "settings"] {
            if let Some(webview) = app.get_webview(label) {
                let handle = app.clone();
                return webview
                    .with_webview(move |webview| cookie::capture(&handle, &webview.controller()))
                    .map_err(|error| error.to_string());
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("当前平台未实现".into())
    }
}

/// 删除站点 Cookie，登录窗口与常驻窗口的 Cookie 库都尝试一次
#[cfg(windows)]
fn forget_cookies(app: &AppHandle) {
    for label in ["wallpaper-login-site", "settings"] {
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(|webview| cookie::forget(&webview.controller()));
        }
    }
}

#[cfg(windows)]
mod cookie {
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::GetCookiesCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows_core::{Interface, HSTRING};

    use super::auth;

    const SITE: &str = "https://mcblock.top";

    /// 登录页轮询：拿到会话 Cookie 才落盘并发事件，否则静默
    pub fn capture(app: &AppHandle, controller: &ICoreWebView2Controller) {
        let Some(manager) = manager(controller) else {
            return;
        };
        let handle = app.clone();
        let generation = auth::generation();
        let uri = HSTRING::from(SITE);
        let handler = GetCookiesCompletedHandler::create(Box::new(move |_result, list| {
            let Some(value) = list.and_then(read_session) else {
                return Ok(());
            };
            if auth::generation() != generation {
                return Ok(());
            }
            if auth::cookie().as_deref() != Some(value.as_str()) {
                if auth::save(&handle, &value).is_err() {
                    return Ok(());
                }
                let _ = handle.emit("wallpaper:session", true);
            }
            close_login(&handle);
            Ok(())
        }));
        // SAFETY: 管理器与回调在 WebView2 消息循环中有效
        unsafe {
            let _ = manager.GetCookies(&uri, &handler);
        }
    }

    /// 退出登录：删除站点会话 Cookie
    pub fn forget(controller: &ICoreWebView2Controller) {
        let Some(manager) = manager(controller) else {
            return;
        };
        let cookies = manager.clone();
        let uri = HSTRING::from(SITE);
        let handler = GetCookiesCompletedHandler::create(Box::new(move |_result, list| {
            if let Some(list) = list {
                let mut count = 0u32;
                // SAFETY: 只读 WebView2 返回的 Cookie 列表
                if unsafe { list.Count(&mut count) }.is_ok() {
                    for index in 0..count {
                        let Ok(cookie) = (unsafe { list.GetValueAtIndex(index) }) else {
                            continue;
                        };
                        let mut name = windows_core::PWSTR::null();
                        if unsafe { cookie.Name(&mut name) }.is_err() {
                            continue;
                        }
                        if take_pwstr(name).to_ascii_lowercase().contains("session-token") {
                            // SAFETY: Cookie 管理器在浏览器进程内存活，删除立即入队
                            unsafe {
                                let _ = cookies.DeleteCookie(&cookie);
                            }
                        }
                    }
                }
            }
            Ok(())
        }));
        // SAFETY: 管理器与回调在 WebView2 消息循环中有效
        unsafe {
            let _ = manager.GetCookies(&uri, &handler);
        }
    }

    fn manager(controller: &ICoreWebView2Controller) -> Option<ICoreWebView2CookieManager> {
        // SAFETY: WebView2 接口在窗口存活期间有效
        unsafe {
            let core = controller.CoreWebView2().ok()?;
            let core13 = core.cast::<ICoreWebView2_13>().ok()?;
            let profile = core13.Profile().ok()?;
            let profile5 = profile.cast::<ICoreWebView2Profile5>().ok()?;
            profile5.CookieManager().ok()
        }
    }

    fn close_login(app: &AppHandle) {
        if let Some(window) = app.get_window("wallpaper-login") {
            let _ = window.close();
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
