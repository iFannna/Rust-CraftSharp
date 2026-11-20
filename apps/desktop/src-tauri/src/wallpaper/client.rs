//! mcblock.top 壁纸列表接口。WinHTTP 原生请求，不引入网络依赖。

use serde::{Deserialize, Serialize};

const API: &str = "https://mcblock.top";
const PAGE_SIZE: u32 = 20;
const MAX_JSON: usize = 4 * 1024 * 1024;
pub const MAX_IMAGE_BYTES: usize = 24 * 1024 * 1024;
/// 动态壁纸视频，4K 片源常见几十到上百 MB
pub const MAX_VIDEO_BYTES: usize = 256 * 1024 * 1024;

/// 列表卡片数据，URL 已补全为绝对地址
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub thumbnail_url: String,
    pub preview_url: String,
    pub resolution: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub items: Vec<Item>,
    pub page: u32,
    pub total_pages: u32,
    pub total: u32,
    pub has_prev: bool,
    pub has_next: bool,
}

#[derive(Deserialize)]
struct Envelope {
    success: bool,
    data: Option<Data>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct Data {
    wallpapers: Vec<RawItem>,
    pagination: Pagination,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawItem {
    id: String,
    title: String,
    #[serde(rename = "type")]
    kind: String,
    thumbnail_url: String,
    preview_url: String,
    #[serde(default)]
    resolution: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pagination {
    page: u32,
    total_pages: u32,
    total: u32,
    has_prev: bool,
    has_next: bool,
}

/// 公共预览图，服务端上限 1920
pub fn preview_url(id: &str) -> String {
    format!("{API}/api/wallpapers/{id}/preview?size=1920")
}

/// 原图或视频，需要登录会话
pub fn original_url(id: &str) -> String {
    format!("{API}/api/wallpapers/{id}/download?resolution=original")
}

pub fn list(page: u32, kind: &str, sort: &str) -> Result<Page, String> {
    if !matches!(kind, "all" | "static" | "dynamic") {
        return Err("壁纸类型无效".into());
    }
    if !matches!(sort, "latest" | "popular" | "downloads") {
        return Err("排序方式无效".into());
    }

    let mut url = format!(
        "{API}/api/wallpapers?category=desktop&page={}&limit={PAGE_SIZE}&sort={sort}",
        page.max(1)
    );
    if kind != "all" {
        url.push_str("&type=");
        url.push_str(kind);
    }

    let body = download(&url, MAX_JSON, None)?;
    let envelope: Envelope =
        serde_json::from_slice(&body).map_err(|_| "壁纸列表解析失败".to_string())?;
    if !envelope.success {
        return Err(envelope.error.unwrap_or_else(|| "壁纸服务返回失败".into()));
    }
    let data = envelope.data.ok_or_else(|| "壁纸列表为空".to_string())?;
    let pagination = data.pagination;

    let items = data
        .wallpapers
        .into_iter()
        .map(|raw| {
            let kind = if raw.kind == "dynamic" { "dynamic" } else { "static" };
            let clean = kind == "static";
            Item {
                thumbnail_url: if clean {
                    super::display::url(&raw.id, "thumb")
                } else {
                    absolute(&raw.thumbnail_url)
                },
                preview_url: if clean {
                    super::display::url(&raw.id, "preview")
                } else {
                    with_size(&absolute(&raw.preview_url), 1920)
                },
                id: raw.id,
                title: raw.title,
                kind: kind.into(),
                resolution: raw.resolution,
            }
        })
        .collect();

    Ok(Page {
        items,
        page: pagination.page,
        total_pages: pagination.total_pages,
        total: pagination.total,
        has_prev: pagination.has_prev,
        has_next: pagination.has_next,
    })
}

/// 下载字节，仅允许 mcblock.top，避免把接口当通用代理
pub fn download(url: &str, limit: usize, cookie: Option<&str>) -> Result<Vec<u8>, String> {
    let url = absolute(url);
    let parsed = parse_url(&url)?;
    if !is_wallpaper_host(parsed.host) {
        return Err("不支持的壁纸地址".into());
    }
    #[cfg(windows)]
    {
        winhttp::get(&parsed, limit, cookie)
    }
    #[cfg(not(windows))]
    {
        let _ = (parsed, limit, cookie);
        Err("当前平台未实现".into())
    }
}

pub fn absolute(url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else if url.starts_with('/') {
        format!("{API}{url}")
    } else {
        format!("{API}/{url}")
    }
}

/// 服务端公共预览上限为 1920，统一收敛尺寸参数，避免无意义的大请求
pub fn with_size(url: &str, size: u32) -> String {
    let Some(base) = url.split('?').next() else {
        return url.to_string();
    };
    let query = url.split_once('?').map(|(_, query)| query).unwrap_or("");
    let mut parts: Vec<String> = query
        .split('&')
        .filter(|part| !part.is_empty() && !part.starts_with("size="))
        .map(str::to_string)
        .collect();
    parts.insert(0, format!("size={size}"));
    format!("{base}?{}", parts.join("&"))
}

fn is_wallpaper_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("mcblock.top") || host.eq_ignore_ascii_case("www.mcblock.top")
}

struct ParsedUrl<'a> {
    secure: bool,
    host: &'a str,
    port: u16,
    path: &'a str,
}

fn parse_url(url: &str) -> Result<ParsedUrl<'_>, String> {
    let (secure, rest) = if let Some(rest) = url.strip_prefix("https://") {
        (true, rest)
    } else if let Some(rest) = url.strip_prefix("http://") {
        (false, rest)
    } else {
        return Err("壁纸地址无效".into());
    };

    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, "/"),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) if !host.is_empty() => {
            let port = port
                .parse::<u16>()
                .map_err(|_| "壁纸地址端口无效".to_string())?;
            (host, port)
        }
        _ => (authority, if secure { 443 } else { 80 }),
    };
    if host.is_empty() {
        return Err("壁纸地址无效".into());
    }
    Ok(ParsedUrl {
        secure,
        host,
        port,
        path,
    })
}

#[cfg(windows)]
mod winhttp {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    use super::ParsedUrl;

    const ACCESS_TYPE_DEFAULT_PROXY: u32 = 0;
    const SECURE: u32 = 0x0080_0000;
    const QUERY_STATUS_CODE: u32 = 19;
    const QUERY_FLAG_NUMBER: u32 = 0x2000_0000;
    const REDIRECT_POLICY: u32 = 66;
    const REDIRECT_ALWAYS: u32 = 2;

    #[link(name = "winhttp")]
    extern "system" {
        fn WinHttpOpen(
            agent: *const u16,
            access_type: u32,
            proxy: *const u16,
            bypass: *const u16,
            flags: u32,
        ) -> isize;
        fn WinHttpConnect(session: isize, server: *const u16, port: u16, reserved: u32) -> isize;
        fn WinHttpOpenRequest(
            connect: isize,
            verb: *const u16,
            path: *const u16,
            version: *const u16,
            referrer: *const u16,
            accept_types: *const *const u16,
            flags: u32,
        ) -> isize;
        fn WinHttpSetTimeouts(
            handle: isize,
            resolve: i32,
            connect: i32,
            send: i32,
            receive: i32,
        ) -> i32;
        fn WinHttpSetOption(handle: isize, option: u32, buffer: *const c_void, len: u32) -> i32;
        fn WinHttpSendRequest(
            request: isize,
            headers: *const u16,
            headers_len: u32,
            optional: *const c_void,
            optional_len: u32,
            total_len: u32,
            context: usize,
        ) -> i32;
        fn WinHttpReceiveResponse(request: isize, reserved: *mut c_void) -> i32;
        fn WinHttpQueryHeaders(
            request: isize,
            info_level: u32,
            name: *const u16,
            buffer: *mut c_void,
            buffer_len: *mut u32,
            index: *mut u32,
        ) -> i32;
        fn WinHttpReadData(
            request: isize,
            buffer: *mut c_void,
            to_read: u32,
            read: *mut u32,
        ) -> i32;
        fn WinHttpCloseHandle(handle: isize) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetLastError() -> u32;
    }

    struct Handle(isize);

    impl Drop for Handle {
        fn drop(&mut self) {
            if self.0 != 0 {
                // SAFETY: 句柄由 WinHttpOpen/Connect/OpenRequest 返回，只关闭一次
                unsafe {
                    WinHttpCloseHandle(self.0);
                }
            }
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn failed(step: &str) -> String {
        // SAFETY: 只读取当前线程最后一次错误码
        let code = unsafe { GetLastError() };
        format!("{step}失败（错误 {code}）")
    }

    pub fn get(url: &ParsedUrl<'_>, limit: usize, cookie: Option<&str>) -> Result<Vec<u8>, String> {
        // SAFETY: 所有句柄都在 Handle 中统一关闭，缓冲区随调用栈存活
        unsafe {
            let agent = wide(concat!("CraftSharp/", env!("CARGO_PKG_VERSION")));
            let session = Handle(WinHttpOpen(
                agent.as_ptr(),
                ACCESS_TYPE_DEFAULT_PROXY,
                std::ptr::null(),
                std::ptr::null(),
                0,
            ));
            if session.0 == 0 {
                return Err(failed("初始化网络"));
            }
            WinHttpSetTimeouts(session.0, 10_000, 15_000, 15_000, 30_000);

            let host = wide(url.host);
            let connect = Handle(WinHttpConnect(session.0, host.as_ptr(), url.port, 0));
            if connect.0 == 0 {
                return Err(failed("连接壁纸服务"));
            }

            let verb = wide("GET");
            let path = wide(url.path);
            let flags = if url.secure { SECURE } else { 0 };
            let request = Handle(WinHttpOpenRequest(
                connect.0,
                verb.as_ptr(),
                path.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                flags,
            ));
            if request.0 == 0 {
                return Err(failed("创建请求"));
            }

            let policy = REDIRECT_ALWAYS;
            WinHttpSetOption(
                request.0,
                REDIRECT_POLICY,
                &policy as *const u32 as *const c_void,
                std::mem::size_of::<u32>() as u32,
            );

            let headers: Vec<u16> = match cookie {
                Some(value) if !value.is_empty() => {
                    format!("Cookie: {value}\r\n").encode_utf16().collect()
                }
                _ => Vec::new(),
            };
            let sent = if headers.is_empty() {
                WinHttpSendRequest(request.0, std::ptr::null(), 0, std::ptr::null(), 0, 0, 0)
            } else {
                WinHttpSendRequest(
                    request.0,
                    headers.as_ptr(),
                    headers.len() as u32,
                    std::ptr::null(),
                    0,
                    0,
                    0,
                )
            };
            if sent == 0 {
                return Err(failed("发送请求"));
            }
            if WinHttpReceiveResponse(request.0, std::ptr::null_mut()) == 0 {
                return Err(failed("读取响应"));
            }

            let mut status: u32 = 0;
            let mut len = std::mem::size_of::<u32>() as u32;
            if WinHttpQueryHeaders(
                request.0,
                QUERY_STATUS_CODE | QUERY_FLAG_NUMBER,
                std::ptr::null(),
                &mut status as *mut u32 as *mut c_void,
                &mut len,
                std::ptr::null_mut(),
            ) == 0
            {
                return Err(failed("读取状态码"));
            }
            if !(200..300).contains(&status) {
                return Err(format!("壁纸服务响应异常（HTTP {status}）"));
            }

            let mut body = Vec::new();
            let mut chunk = vec![0u8; 64 * 1024];
            loop {
                let mut read: u32 = 0;
                if WinHttpReadData(
                    request.0,
                    chunk.as_mut_ptr() as *mut c_void,
                    chunk.len() as u32,
                    &mut read,
                ) == 0
                {
                    return Err(failed("读取数据"));
                }
                if read == 0 {
                    break;
                }
                if body.len() + read as usize > limit {
                    return Err("壁纸文件过大".into());
                }
                body.extend_from_slice(&chunk[..read as usize]);
            }
            Ok(body)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_urls() {
        assert_eq!(
            absolute("/api/wallpapers/a/preview?size=800"),
            "https://mcblock.top/api/wallpapers/a/preview?size=800"
        );
    }

    #[test]
    fn rewrites_preview_size() {
        assert_eq!(
            with_size("https://mcblock.top/a?size=800&v=1", 1920),
            "https://mcblock.top/a?size=1920&v=1"
        );
        assert_eq!(
            with_size("https://mcblock.top/a", 1920),
            "https://mcblock.top/a?size=1920"
        );
    }

    #[test]
    fn rejects_foreign_hosts() {
        assert!(download("https://example.com/a.jpg", 1024, None).is_err());
    }

    #[test]
    fn parses_list_response() {
        let body = br#"{"success":true,"data":{"wallpapers":[{"id":"wp_1","title":"A","type":"static","thumbnailUrl":"/t.jpg","previewUrl":"/p.jpg?size=1920","resolution":"1920x1080"}],"pagination":{"page":1,"limit":20,"total":1,"totalPages":1,"hasNext":false,"hasPrev":false}}}"#;
        let envelope: Envelope = serde_json::from_slice(body).unwrap();
        let data = envelope.data.unwrap();
        assert_eq!(data.wallpapers[0].id, "wp_1");
        assert_eq!(data.pagination.total_pages, 1);
    }
}
