//! 动态壁纸取流：WebKit 只把 http(s) 交给自带取流器，自定义协议在媒体
//! 加载阶段直接报 FormatError，因此视频走一个只监听回环的最小 HTTP 服务。

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;

use tauri::AppHandle;

use super::display::{self, SliceError};
use super::store;

static SERVER: OnceLock<Option<Server>> = OnceLock::new();

struct Server {
    port: u16,
    token: String,
}

/// 进程内启动一次；失败只影响动态壁纸，窗口保留封面
pub fn init(app: &AppHandle) {
    let _ = SERVER.get_or_init(|| match start(app.clone()) {
        Ok(server) => Some(server),
        Err(error) => {
            eprintln!("wallpaper-stream: {error}");
            None
        }
    });
}

/// 某块屏的播放地址；服务未起时返回空串，页面会退回封面
pub fn url(id: &str) -> String {
    let Some(Some(server)) = SERVER.get() else {
        return String::new();
    };
    format!(
        "http://127.0.0.1:{}/{}/{}/video",
        server.port, server.token, id
    )
}

fn start(app: AppHandle) -> Result<Server, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let token = token();
    let shared = token.clone();
    thread::Builder::new()
        .name("wallpaper-stream".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let app = app.clone();
                let token = shared.clone();
                let _ = thread::Builder::new()
                    .name("wallpaper-stream-conn".into())
                    .spawn(move || {
                        let _ = handle(&app, stream, &token);
                    });
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(Server { port, token })
}

/// 本进程专属路径段，避免本机其他页面按固定地址读到缓存
fn token() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos() as u64)
        .unwrap_or(0);
    format!("{:016x}", nanos ^ ((std::process::id() as u64) << 32))
}

fn handle(app: &AppHandle, mut stream: TcpStream, token: &str) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?);

    let mut request = String::new();
    reader.read_line(&mut request)?;
    let mut parts = request.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();

    let mut range = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("range") {
                range = Some(value.trim().to_string());
            }
        }
    }

    let mut segments = path.trim_start_matches('/').split('/');
    let token_ok = segments.next() == Some(token);
    let id = segments.next().unwrap_or_default();
    let tail_ok = segments.next() == Some("video") && segments.next().is_none();
    if !token_ok || !tail_ok || store::file_id(id).is_err() {
        return respond(&mut stream, &method, 404, &[], 0);
    }

    let Some(file) = store::cached_video(app, id) else {
        return respond(&mut stream, &method, 404, &[], 0);
    };
    let slice = match display::video_slice(&file, range.as_deref()) {
        Ok(slice) => slice,
        Err(SliceError::Range(total)) => {
            let value = format!("bytes */{total}");
            return respond(
                &mut stream,
                &method,
                416,
                &[("Content-Range", value.as_str())],
                0,
            );
        }
        Err(SliceError::Missing) => return respond(&mut stream, &method, 404, &[], 0),
    };

    let mut headers = vec![
        ("Content-Type", slice.mime.to_string()),
        ("Accept-Ranges", "bytes".to_string()),
        ("Cache-Control", "no-store".to_string()),
        ("Content-Length", slice.length.to_string()),
    ];
    if slice.partial {
        headers.push((
            "Content-Range",
            format!(
                "bytes {}-{}/{}",
                slice.start,
                slice.start + slice.length - 1,
                slice.total
            ),
        ));
    }
    let pairs: Vec<(&str, &str)> = headers
        .iter()
        .map(|(name, value)| (*name, value.as_str()))
        .collect();
    respond(
        &mut stream,
        &method,
        if slice.partial { 206 } else { 200 },
        &pairs,
        slice.length,
    )?;
    if method != "HEAD" {
        copy(&mut stream, slice)?;
    }
    Ok(())
}

/// 写状态行与响应头；带长度时不写正文，由调用方流式拷贝
fn respond(
    stream: &mut TcpStream,
    method: &str,
    status: u16,
    headers: &[(&str, &str)],
    length: u64,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        206 => "Partial Content",
        416 => "Range Not Satisfiable",
        _ => "Not Found",
    };
    let mut head = format!("HTTP/1.1 {status} {reason}\r\nConnection: close\r\n");
    for (name, value) in headers {
        head.push_str(name);
        head.push_str(": ");
        head.push_str(value);
        head.push_str("\r\n");
    }
    if length == 0 && !headers.iter().any(|(name, _)| *name == "Content-Length") {
        head.push_str("Content-Length: 0\r\n");
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.flush()?;
    if method == "HEAD" {
        return Ok(());
    }
    Ok(())
}

/// 分块写回，避免整段视频读进内存
fn copy(stream: &mut TcpStream, mut slice: display::Slice) -> std::io::Result<()> {
    let mut buffer = vec![0u8; 64 * 1024];
    let mut left = slice.length;
    while left > 0 {
        let want = left.min(buffer.len() as u64) as usize;
        let read = slice.file.read(&mut buffer[..want])?;
        if read == 0 {
            break;
        }
        stream.write_all(&buffer[..read])?;
        left -= read as u64;
    }
    stream.flush()
}
