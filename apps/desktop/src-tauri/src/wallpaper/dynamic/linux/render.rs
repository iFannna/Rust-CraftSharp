//! 原生 GStreamer 渲染：XvImage 直绘桌面窗口，首帧就绪后再显示。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use gstreamer as gst;
use gstreamer::glib::translate::*;
use gstreamer::prelude::*;
use gstreamer_video::VideoOverlay;
use tauri::{AppHandle, Emitter, Window};

use super::super::super::store::{self, Transform};
use super::{window, Bounds};

const EVENT: &str = "wallpaper-video-error";
/// Xv 覆盖层不吃窗口透明度和输入区，GL 在本机会崩；只用 XImage 逐帧绘制
const SINK: &str = "ximagesink";

#[derive(Clone, Debug, PartialEq)]
pub(super) struct RenderSpec {
    pub video: PathBuf,
    pub bounds: Bounds,
    pub scale: f64,
    pub span: Option<Bounds>,
    pub transform: Option<Transform>,
}

pub(super) enum Command {
    Pause(bool),
    Switch(Box<RenderSpec>),
    Stop,
}

#[derive(Clone)]
pub(super) struct Handle {
    pub control: Sender<Command>,
    pub alive: Arc<AtomicBool>,
}

pub(super) fn spawn(
    spec: RenderSpec,
    xid: u32,
    window: Window,
    app: AppHandle,
    label: String,
) -> Result<Handle, String> {
    let (control, commands) = mpsc::channel();
    let alive = Arc::new(AtomicBool::new(true));
    let flag = alive.clone();
    std::thread::Builder::new()
        .name("wallpaper-render".into())
        .spawn(move || run(spec, xid, window, app, label, commands, flag))
        .map_err(|error| format!("启动壁纸渲染失败：{error}"))?;
    Ok(Handle { control, alive })
}

fn run(
    spec: RenderSpec,
    xid: u32,
    window: Window,
    app: AppHandle,
    label: String,
    commands: Receiver<Command>,
    alive: Arc<AtomicBool>,
) {
    let (mut pipeline, mut frames) = match render(&spec, xid) {
        Ok(pair) => pair,
        Err(error) => {
            fail(&app, &window, &label, &error, &alive);
            return;
        }
    };
    let Some(mut bus) = pipeline.bus() else {
        fail(&app, &window, &label, "壁纸总线不可用", &alive);
        return;
    };
    let mut paused = false;
    let mut moved = false;
    let mut ready_at: Option<usize> = None;
    loop {
        while let Some(message) = bus.pop() {
            match message.view() {
                gst::MessageView::Eos(..) => {
                    let _ = pipeline.seek_simple(
                        gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
                        gst::ClockTime::ZERO,
                    );
                }
                gst::MessageView::Error(error) => {
                    let detail = match error.debug() {
                        Some(debug) => format!("{} ({debug})", error.error()),
                        None => error.error().to_string(),
                    };
                    fail(&app, &window, &label, &detail, &alive);
                    let _ = pipeline.set_state(gst::State::Null);
                    return;
                }
                _ => {}
            }
        }

        match commands.recv_timeout(Duration::from_millis(50)) {
            Ok(Command::Pause(value)) => {
                if value != paused {
                    let next = if value {
                        gst::State::Paused
                    } else {
                        gst::State::Playing
                    };
                    if pipeline.set_state(next).is_ok() {
                        paused = value;
                    }
                }
            }
            Ok(Command::Switch(next)) => {
                let _ = pipeline.set_state(gst::State::Null);
                match render(&next, xid) {
                    Ok((next_pipeline, next_frames)) => {
                        match next_pipeline.bus() {
                            Some(next_bus) => bus = next_bus,
                            None => {
                                fail(&app, &window, &label, "壁纸总线不可用", &alive);
                                let _ = next_pipeline.set_state(gst::State::Null);
                                return;
                            }
                        }
                        pipeline = next_pipeline;
                        frames = next_frames;
                        if paused {
                            let _ = pipeline.set_state(gst::State::Paused);
                        }
                    }
                    Err(error) => {
                        fail(&app, &window, &label, &error, &alive);
                        return;
                    }
                }
            }
            Ok(Command::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        if !moved {
            let count = frames.load(Ordering::Relaxed);
            match ready_at {
                // 先在屏幕外把画面播起来，再移进桌面，映射瞬间就是视频帧
                Some(at) if count >= at + 2 => {
                    moved = true;
                    let target = window.clone();
                    let bounds = spec.bounds;
                    let scale = spec.scale;
                    let _ = app.run_on_main_thread(move || {
                        if let Err(error) = window::place(&target, bounds, scale) {
                            eprintln!("wallpaper-show: {error}");
                            return;
                        }
                        if let Err(error) = window::set_opacity(xid, u32::MAX) {
                            eprintln!("wallpaper-reveal: {error}");
                        }
                    });
                }
                Some(_) => {}
                None => {
                    if count > 0 {
                        ready_at = Some(count);
                    }
                }
            }
        }
    }
    let _ = pipeline.set_state(gst::State::Null);
    alive.store(false, Ordering::Relaxed);
}

fn fail(
    app: &AppHandle,
    window: &Window,
    label: &str,
    error: &str,
    alive: &AtomicBool,
) {
    alive.store(false, Ordering::Relaxed);
    eprintln!("wallpaper-render[{label}]: {error}");
    let _ = app.emit(EVENT, error.to_string());
    let _ = window.close();
}

fn render(spec: &RenderSpec, xid: u32) -> Result<(gst::Pipeline, Arc<AtomicUsize>), String> {
    ensure_gst()?;
    build(spec, xid, SINK)
}

fn build(
    spec: &RenderSpec,
    xid: u32,
    sink_name: &str,
) -> Result<(gst::Pipeline, Arc<AtomicUsize>), String> {
    let pipeline = gst::Pipeline::new();
    let element = |name: &str| {
        gst::ElementFactory::make(name)
            .build()
            .map_err(|error| format!("缺少 GStreamer 组件 {name}：{error}"))
    };
    let source = element("filesrc")?;
    let decode = element("decodebin")?;
    let convert = element("videoconvert")?;
    let crop = element("videocrop")?;
    let scale = element("videoscale")?;
    let caps = element("capsfilter")?;
    let sink = element(sink_name)?;

    source.set_property("location", spec.video.to_string_lossy().to_string());
    let width = spec.bounds.width().max(1) as i32;
    let height = spec.bounds.height().max(1) as i32;
    let limits = gst::Caps::builder("video/x-raw")
        .field("width", width)
        .field("height", height)
        .field("pixel-aspect-ratio", gst::Fraction::new(1, 1))
        .build();
    caps.set_property("caps", &limits);
    sink.set_property("force-aspect-ratio", false);
    if sink.find_property("handle-expose").is_some() {
        sink.set_property("handle-expose", true);
    }
    if sink.find_property("show-preroll-frame").is_some() {
        sink.set_property("show-preroll-frame", true);
    }
    overlay(&sink, xid)?;

    for item in [&source, &decode, &convert, &crop, &scale, &caps, &sink] {
        pipeline
            .add(item)
            .map_err(|error| format!("壁纸组件挂载失败：{error}"))?;
    }
    gst::Element::link_many(&[&source, &decode])
        .map_err(|error| format!("壁纸解码连接失败：{error}"))?;
    gst::Element::link_many(&[&convert, &crop, &scale, &caps, &sink])
        .map_err(|error| format!("壁纸组件连接失败：{error}"))?;

    let convert_sink = convert
        .static_pad("sink")
        .ok_or_else(|| "视频转换组件不可用".to_string())?;
    decode.connect_pad_added(move |_, pad| {
        if pad.link(&convert_sink).is_err() {
            eprintln!("wallpaper-render: 跳过未连接的 {} 垫片", pad.name());
        }
    });
    let crop_sink = crop
        .static_pad("sink")
        .ok_or_else(|| "视频裁切组件不可用".to_string())?;
    let crop_spec = spec.clone();
    let configured = Arc::new(AtomicBool::new(false));
    let crop = crop.clone();
    crop_sink.add_probe(gst::PadProbeType::BUFFER, move |pad, _| {
        if !configured.swap(true, Ordering::Relaxed) {
            if let Some(caps) = pad.current_caps() {
                if let Some(structure) = caps.structure(0) {
                    let width = structure.get::<i32>("width").ok();
                    let height = structure.get::<i32>("height").ok();
                    if let (Some(width), Some(height)) = (width, height) {
                        let rect = crop_for(width as u32, height as u32, &crop_spec);
                        let _ = crop.set_property("left", rect.left);
                        let _ = crop.set_property("top", rect.top);
                        let _ = crop.set_property("right", rect.right);
                        let _ = crop.set_property("bottom", rect.bottom);
                    }
                }
            }
        }
        gst::PadProbeReturn::Ok
    });

    pipeline
        .set_state(gst::State::Paused)
        .map_err(|error| format!("{sink_name} 启动失败：{error}"))?;
    let (result, state, _) = pipeline.state(Some(gst::ClockTime::from_seconds(5)));
    if result.is_err() || state != gst::State::Paused {
        let detail = bus_error(&pipeline);
        let _ = pipeline.set_state(gst::State::Null);
        return Err(format!("{sink_name} 首帧就绪失败：{detail}"));
    }
    // PAUSED 阶段只保证有预卷帧，sink 未必已经画进窗口；
    // 等播放状态下真正渲染出帧，再把窗口从屏幕外移进来
    let sink_pad = sink
        .static_pad("sink")
        .ok_or_else(|| "视频输出组件不可用".to_string())?;
    let frames = Arc::new(AtomicUsize::new(0));
    let counter = frames.clone();
    sink_pad.add_probe(gst::PadProbeType::BUFFER, move |_, _| {
        counter.fetch_add(1, Ordering::Relaxed);
        gst::PadProbeReturn::Ok
    });
    pipeline
        .set_state(gst::State::Playing)
        .map_err(|error| format!("{sink_name} 播放失败：{error}"))?;
    if let Err(error) = window::set_click_through(xid) {
        let _ = pipeline.set_state(gst::State::Null);
        return Err(error);
    }
    Ok((pipeline, frames))
}

fn overlay(sink: &gst::Element, xid: u32) -> Result<(), String> {
    let overlay = sink
        .clone()
        .dynamic_cast::<VideoOverlay>()
        .map_err(|_| "GStreamer 窗口叠加不可用".to_string())?;
    unsafe {
        gstreamer_video::ffi::gst_video_overlay_set_window_handle(
            overlay.to_glib_none().0,
            xid as usize,
        );
    }
    Ok(())
}

fn bus_error(pipeline: &gst::Pipeline) -> String {
    let Some(bus) = pipeline.bus() else {
        return "总线不可用".into();
    };
    while let Some(message) = bus.pop() {
        if let gst::MessageView::Error(error) = message.view() {
            return match error.debug() {
                Some(debug) => format!("{} ({debug})", error.error()),
                None => error.error().to_string(),
            };
        }
    }
    "未知错误".into()
}

static INIT: OnceLock<Result<(), String>> = OnceLock::new();

fn ensure_gst() -> Result<(), String> {
    INIT.get_or_init(|| gst::init().map_err(|error| error.to_string()))
        .clone()
}

#[derive(Clone, Copy, Debug)]
struct Crop {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

/// 与 Windows 渲染器同一套 source_rect/span 语义，换算成四边裁切量
fn crop_for(frame_width: u32, frame_height: u32, spec: &RenderSpec) -> Crop {
    let frame_w = frame_width.max(1) as f64;
    let frame_h = frame_height.max(1) as f64;
    let transform = spec.transform.unwrap_or_default();
    let rect = match spec.span {
        Some(span) => {
            let virtual_w = span.width().max(1) as f64;
            let virtual_h = span.height().max(1) as f64;
            let (rx, ry, rw, _) = store::source_rect(frame_w, frame_h, virtual_w, virtual_h, transform);
            let scale = (virtual_w / rw.max(1.0)).max(f64::EPSILON);
            let offset_x = (spec.bounds.left - span.left) as f64;
            let offset_y = (spec.bounds.top - span.top) as f64;
            (
                rx + offset_x / scale,
                ry + offset_y / scale,
                (spec.bounds.width() as f64 / scale).max(1.0),
                (spec.bounds.height() as f64 / scale).max(1.0),
            )
        }
        None => store::source_rect(
            frame_w,
            frame_h,
            spec.bounds.width().max(1) as f64,
            spec.bounds.height().max(1) as f64,
            transform,
        ),
    };
    let left = rect.0.round().max(0.0).min(frame_w - 1.0) as i32;
    let top = rect.1.round().max(0.0).min(frame_h - 1.0) as i32;
    let right = (frame_w - (rect.0 + rect.2).round()).max(0.0) as i32;
    let bottom = (frame_h - (rect.1 + rect.3).round()).max(0.0) as i32;
    Crop {
        left,
        top,
        right,
        bottom,
    }
}