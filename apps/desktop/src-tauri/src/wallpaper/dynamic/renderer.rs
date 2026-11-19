//! Media Foundation 解码 + D3D11 Video Processor 渲染到 WorkerW 子窗口。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use windows::core::{w, Interface, BOOL, GUID, HSTRING, PCWSTR};
use windows::Win32::Foundation::{HINSTANCE, HWND, RECT};
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_10_0, D3D_FEATURE_LEVEL_10_1,
    D3D_FEATURE_LEVEL_11_0,
};
use windows::Win32::Graphics::Direct3D10::ID3D10Multithread;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dwm::DwmFlush;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::*;

use super::super::store::{source_rect, Transform};

const VIDEO_STREAM: u32 = -4i32 as u32;
const ALL_STREAMS: u32 = -2i32 as u32;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Bounds {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

#[derive(Clone, Debug)]
pub struct Spec {
    pub video: PathBuf,
    pub bounds: Bounds,
    pub transform: Option<Transform>,
    pub device: Option<String>,
    /// 拼接模式下整个虚拟桌面的范围，每块屏按自己的窗口裁取对应部分
    pub span: Option<Bounds>,
}

impl Spec {
    pub fn same(&self, other: &Spec) -> bool {
        self.video == other.video
            && self.bounds == other.bounds
            && self.transform == other.transform
            && self.device == other.device
            && self.span == other.span
    }
}

enum Command {
    Switch(Spec, mpsc::Sender<Result<(), String>>),
}

pub struct Handle {
    pub spec: Spec,
    pub stop: Arc<AtomicBool>,
    pub paused: Arc<AtomicBool>,
    pub hwnd: Arc<AtomicIsize>,
    sender: mpsc::Sender<Command>,
    pub thread: std::thread::JoinHandle<()>,
}

/// 在原窗口内切换片源，桌面始终被覆盖
pub fn switch(handle: &Handle, spec: &Spec) -> Result<(), String> {
    let (reply, wait) = mpsc::channel();
    handle
        .sender
        .send(Command::Switch(spec.clone(), reply))
        .map_err(|_| "壁纸实例已失效".to_string())?;
    wait.recv_timeout(Duration::from_secs(3))
        .map_err(|_| "切换视频超时".to_string())?
}

impl Handle {
    pub fn alive(&self) -> bool {
        let raw = self.hwnd.load(Ordering::Relaxed);
        // SAFETY: 句柄值只用于查询窗口是否仍存在
        raw != 0 && unsafe { IsWindow(Some(HWND(raw as *mut _))) }.as_bool()
    }
}

pub fn start(spec: Spec) -> Result<Handle, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let hwnd = Arc::new(AtomicIsize::new(0));
    let (ready_tx, ready_rx) = mpsc::channel();
    let (sender, commands) = mpsc::channel();

    let thread = {
        let stop = stop.clone();
        let paused = paused.clone();
        let hwnd = hwnd.clone();
        let spec = spec.clone();
        std::thread::Builder::new()
            .name("wallpaper-video".into())
            .spawn(move || run(spec, stop, paused, hwnd, ready_tx, commands))
            .map_err(|error| error.to_string())?
    };

    match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => Ok(Handle {
            spec,
            stop,
            paused,
            hwnd,
            sender,
            thread,
        }),
        Ok(Err(error)) => {
            stop.store(true, Ordering::Relaxed);
            let _ = thread.join();
            Err(error)
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            Err("动态壁纸初始化超时".into())
        }
    }
}

fn run(
    spec: Spec,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    hwnd_slot: Arc<AtomicIsize>,
    ready: mpsc::Sender<Result<(), String>>,
    commands: mpsc::Receiver<Command>,
) {
    // SAFETY: 每个渲染线程独立初始化 COM
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok() };

    match Player::new(&spec) {
        Ok(player) => {
            hwnd_slot.store(player.surface.hwnd.0 as isize, Ordering::Relaxed);
            player.run(&stop, &paused, ready, commands);
            hwnd_slot.store(0, Ordering::Relaxed);
        }
        Err(error) => {
            let _ = ready.send(Err(error));
        }
    }

    if initialized {
        unsafe { CoUninitialize() };
    }
}

struct Surface {
    hwnd: HWND,
    swap: IDXGISwapChain1,
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    width: i32,
    height: i32,
}

struct Feed {
    reader: IMFSourceReader,
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
    source: RECT,
    dest: RECT,
}

impl Feed {
    unsafe fn open(
        spec: &Spec,
        attributes: &IMFAttributes,
        surface: &Surface,
    ) -> Result<Feed, String> {
        unsafe {
            let (reader, frame_w, frame_h) = open_reader(&spec.video, attributes)?;
            let content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                InputFrameRate: DXGI_RATIONAL {
                    Numerator: 30,
                    Denominator: 1,
                },
                InputWidth: frame_w,
                InputHeight: frame_h,
                OutputFrameRate: DXGI_RATIONAL {
                    Numerator: 30,
                    Denominator: 1,
                },
                OutputWidth: surface.width as u32,
                OutputHeight: surface.height as u32,
                Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
            };
            let enumerator = surface
                .video_device
                .CreateVideoProcessorEnumerator(&content)
                .map_err(|_| "视频处理器创建失败".to_string())?;
            let processor = surface
                .video_device
                .CreateVideoProcessor(&enumerator, 0)
                .map_err(|_| "视频处理器初始化失败".to_string())?;
            let source = match &spec.span {
                Some(virtual_bounds) => span_source(
                    frame_w,
                    frame_h,
                    spec.bounds,
                    *virtual_bounds,
                    spec.transform,
                ),
                None => source_rect_for(
                    frame_w,
                    frame_h,
                    surface.width,
                    surface.height,
                    spec.transform,
                ),
            };
            Ok(Feed {
                reader,
                enumerator,
                processor,
                source,
                dest: RECT {
                    left: 0,
                    top: 0,
                    right: surface.width,
                    bottom: surface.height,
                },
            })
        }
    }
}

struct Player {
    surface: Surface,
    attributes: IMFAttributes,
    feed: Feed,
}

impl Player {
    fn new(spec: &Spec) -> Result<Self, String> {
        // SAFETY: 全部接口由当前线程创建并在 Drop 中释放
        unsafe {
            ensure_mf();
            let hwnd = create_host(spec.bounds)?;
            let width = spec.bounds.width().max(1);
            let height = spec.bounds.height().max(1);

            let mut device: Option<ID3D11Device> = None;
            let mut context: Option<ID3D11DeviceContext> = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                Default::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                Some(&[
                    D3D_FEATURE_LEVEL_11_0,
                    D3D_FEATURE_LEVEL_10_1,
                    D3D_FEATURE_LEVEL_10_0,
                ]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .map_err(|_| "显卡初始化失败".to_string())?;
            let device = device.ok_or("显卡不可用")?;
            let context = context.ok_or("显卡上下文不可用")?;
            if let Ok(multithread) = device.cast::<ID3D10Multithread>() {
                let _ = multithread.SetMultithreadProtected(true);
            }

            let mut token = 0u32;
            let mut manager: Option<IMFDXGIDeviceManager> = None;
            MFCreateDXGIDeviceManager(&mut token, &mut manager)
                .map_err(|_| "媒体设备管理器创建失败".to_string())?;
            let manager = manager.ok_or("媒体设备管理器不可用")?;
            manager
                .ResetDevice(&device, token)
                .map_err(|_| "媒体设备绑定失败".to_string())?;

            let mut attributes: Option<IMFAttributes> = None;
            MFCreateAttributes(&mut attributes, 4).map_err(|_| "媒体属性创建失败".to_string())?;
            let attributes = attributes.ok_or("媒体属性不可用")?;
            let _ = attributes.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1);
            let _ = attributes.SetUINT32(&MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, 1);
            let _ = attributes.SetUINT32(&MF_LOW_LATENCY, 1);
            attributes
                .SetUnknown(&MF_SOURCE_READER_D3D_MANAGER, &manager)
                .map_err(|_| "硬解上下文绑定失败".to_string())?;

            let factory: IDXGIFactory2 =
                CreateDXGIFactory1().map_err(|_| "显示工厂创建失败".to_string())?;
            let desc = DXGI_SWAP_CHAIN_DESC1 {
                Width: width as u32,
                Height: height as u32,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                Stereo: BOOL(0),
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
                BufferCount: 2,
                Scaling: DXGI_SCALING_STRETCH,
                SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
                AlphaMode: DXGI_ALPHA_MODE_IGNORE,
                Flags: 0,
            };
            let swap = factory
                .CreateSwapChainForHwnd(&device, hwnd, &desc, None, None)
                .map_err(|_| "壁纸画面创建失败".to_string())?;

            let video_device: ID3D11VideoDevice =
                device.cast().map_err(|_| "视频设备不可用".to_string())?;
            let video_context: ID3D11VideoContext =
                context.cast().map_err(|_| "视频上下文不可用".to_string())?;
            let surface = Surface {
                hwnd,
                swap,
                video_device,
                video_context,
                width,
                height,
            };
            let feed = Feed::open(spec, &attributes, &surface)?;
            Ok(Self {
                surface,
                attributes,
                feed,
            })
        }
    }

    /// 同一个窗口内换片源，窗口不重建
    fn switch(&mut self, spec: &Spec) -> Result<(), String> {
        let feed = unsafe { Feed::open(spec, &self.attributes, &self.surface) }?;
        self.feed = feed;
        Ok(())
    }

    fn run(
        mut self,
        stop: &AtomicBool,
        paused: &AtomicBool,
        ready: mpsc::Sender<Result<(), String>>,
        commands: mpsc::Receiver<Command>,
    ) {
        let mut ready = Some(ready);
        let mut shown = false;
        let mut first_ts: Option<i64> = None;
        let mut started = Instant::now();
        let mut was_paused = false;

        while !stop.load(Ordering::Relaxed) {
            while let Ok(Command::Switch(spec, reply)) = commands.try_recv() {
                let result = self.switch(&spec);
                if result.is_ok() {
                    // 新片源时间轴从头开始，重置播放节奏避免加速
                    first_ts = None;
                    started = Instant::now();
                    was_paused = false;
                }
                let _ = reply.send(result);
            }
            if paused.load(Ordering::Relaxed) {
                was_paused = true;
                std::thread::sleep(Duration::from_millis(60));
                continue;
            }
            if was_paused {
                was_paused = false;
                first_ts = None;
                started = Instant::now();
            }

            // SAFETY: 读取与渲染都在当前线程完成
            let sample = unsafe {
                let mut actual = 0u32;
                let mut flags = 0u32;
                let mut timestamp = 0i64;
                let mut sample: Option<IMFSample> = None;
                if self
                    .feed
                    .reader
                    .ReadSample(
                        VIDEO_STREAM,
                        0,
                        Some(&mut actual),
                        Some(&mut flags),
                        Some(&mut timestamp),
                        Some(&mut sample),
                    )
                    .is_err()
                {
                    break;
                }
                if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
                    let position = PROPVARIANT::from(0i64);
                    let _ = self
                        .feed
                        .reader
                        .SetCurrentPosition(&GUID::from_u128(0), &position);
                    first_ts = None;
                    started = Instant::now();
                    continue;
                }
                sample.map(|sample| (sample, timestamp))
            };

            let Some((sample, timestamp)) = sample else {
                continue;
            };
            let origin = *first_ts.get_or_insert(timestamp);
            let due = Duration::from_nanos(((timestamp - origin).max(0) as u64) * 100);
            let elapsed = started.elapsed();
            if due > elapsed {
                let wait = (due - elapsed).min(Duration::from_millis(200));
                std::thread::sleep(wait);
            }

            // SAFETY: 画面只在当前线程提交，接口引用在函数结束前释放
            unsafe {
                if self.present(&sample).is_err() {
                    break;
                }
                if !shown {
                    shown = true;
                    let _ = SetWindowPos(
                        self.surface.hwnd,
                        Some(HWND_TOP),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE
                            | SWP_NOSIZE
                            | SWP_NOACTIVATE
                            | SWP_SHOWWINDOW,
                    );
                } else if let Some(notify) = ready.take() {
                    // 新窗口已合成后才允许关闭旧实例，跨模式切换也不会露底
                    let _ = DwmFlush();
                    let _ = notify.send(Ok(()));
                }
                let mut message = MSG::default();
                while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        }

        if let Some(notify) = ready.take() {
            let _ = notify.send(Err("视频未能出画".into()));
        }
        // SAFETY: 窗口与接口都在创建线程销毁
        unsafe {
            let _ = DestroyWindow(self.surface.hwnd);
        }
    }

    unsafe fn present(&mut self, sample: &IMFSample) -> windows::core::Result<()> {
        let input =
            unsafe { make_input_view(&self.surface.video_device, &self.feed.enumerator, sample) }?;
        let output = unsafe { self.output_view() }?;
        unsafe {
            self.surface.video_context.VideoProcessorSetStreamSourceRect(
                &self.feed.processor,
                0,
                true,
                Some(&self.feed.source),
            );
            self.surface.video_context.VideoProcessorSetStreamDestRect(
                &self.feed.processor,
                0,
                true,
                Some(&self.feed.dest),
            );
            let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: BOOL(1),
                OutputIndex: 0,
                InputFrameOrField: 0,
                PastFrames: 0,
                FutureFrames: 0,
                ppPastSurfaces: std::ptr::null_mut(),
                pInputSurface: std::mem::ManuallyDrop::new(Some(input)),
                ppFutureSurfaces: std::ptr::null_mut(),
                ppPastSurfacesRight: std::ptr::null_mut(),
                pInputSurfaceRight: std::mem::ManuallyDrop::new(None),
                ppFutureSurfacesRight: std::ptr::null_mut(),
            };
            let result = self.surface.video_context.VideoProcessorBlt(
                &self.feed.processor,
                &output,
                0,
                std::slice::from_ref(&stream),
            );
            std::mem::ManuallyDrop::drop(&mut stream.pInputSurface);
            std::mem::ManuallyDrop::drop(&mut stream.pInputSurfaceRight);
            result?;
            self.surface.swap.Present(0, DXGI_PRESENT(0)).ok()?;
        }
        Ok(())
    }

    unsafe fn output_view(&self) -> windows::core::Result<ID3D11VideoProcessorOutputView> {
        unsafe {
            let back_buffer: ID3D11Texture2D = self.surface.swap.GetBuffer::<ID3D11Texture2D>(0)?;
            let desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                    Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
                },
            };
            let mut output: Option<ID3D11VideoProcessorOutputView> = None;
            self.surface.video_device.CreateVideoProcessorOutputView(
                &back_buffer,
                &self.feed.enumerator,
                &desc,
                Some(&mut output),
            )?;
            output.ok_or_else(windows::core::Error::from_thread)
        }
    }
}

/// 打开视频并协商成 NV12，返回源尺寸
unsafe fn open_reader(
    path: &std::path::Path,
    attributes: &IMFAttributes,
) -> Result<(IMFSourceReader, u32, u32), String> {
    unsafe {
        let path = HSTRING::from(path.to_string_lossy().as_ref());
        let reader = MFCreateSourceReaderFromURL(&path, attributes)
            .map_err(|_| "视频打开失败".to_string())?;
        reader.SetStreamSelection(ALL_STREAMS, false).ok();
        reader.SetStreamSelection(VIDEO_STREAM, true).ok();

        let native = reader
            .GetNativeMediaType(VIDEO_STREAM, 0)
            .map_err(|_| "视频没有可用画面".to_string())?;
        let size = native.GetUINT64(&MF_MT_FRAME_SIZE).unwrap_or(0);
        let frame_w = (size >> 32) as u32;
        let frame_h = size as u32;
        if frame_w == 0 || frame_h == 0 {
            return Err("视频尺寸无效".into());
        }
        let rate = native
            .GetUINT64(&MF_MT_FRAME_RATE)
            .unwrap_or((30u64 << 32) | 1);
        let aspect = native
            .GetUINT64(&MF_MT_PIXEL_ASPECT_RATIO)
            .unwrap_or((1u64 << 32) | 1);

        let media_type = MFCreateMediaType().map_err(|_| "视频格式创建失败".to_string())?;
        media_type
            .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .map_err(|_| "视频格式设置失败".to_string())?;
        media_type
            .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)
            .map_err(|_| "硬解格式设置失败".to_string())?;
        media_type
            .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
            .ok();
        media_type.SetUINT64(&MF_MT_FRAME_SIZE, size).ok();
        media_type.SetUINT64(&MF_MT_FRAME_RATE, rate).ok();
        media_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, aspect).ok();
        reader
            .SetCurrentMediaType(VIDEO_STREAM, None, &media_type)
            .map_err(|_| "硬解输出格式不支持".to_string())?;
        Ok((reader, frame_w, frame_h))
    }
}

unsafe fn make_input_view(
    device: &ID3D11VideoDevice,
    enumerator: &ID3D11VideoProcessorEnumerator,
    sample: &IMFSample,
) -> windows::core::Result<ID3D11VideoProcessorInputView> {
    unsafe {
        let buffer = sample.GetBufferByIndex(0)?;
        let dxgi: IMFDXGIBuffer = buffer.cast()?;
        let mut resource: *mut std::ffi::c_void = std::ptr::null_mut();
        dxgi.GetResource(&ID3D11Texture2D::IID, &mut resource)?;
        if resource.is_null() {
            return Err(windows::core::Error::from_thread());
        }
        let texture = ID3D11Texture2D::from_raw(resource);
        let slice = dxgi.GetSubresourceIndex().unwrap_or(0);

        let desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            FourCC: 0,
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPIV {
                    MipSlice: 0,
                    ArraySlice: slice,
                },
            },
        };
        let mut input: Option<ID3D11VideoProcessorInputView> = None;
        device.CreateVideoProcessorInputView(&texture, enumerator, &desc, Some(&mut input))?;
        input.ok_or_else(windows::core::Error::from_thread)
    }
}

fn source_rect_for(
    frame_w: u32,
    frame_h: u32,
    width: i32,
    height: i32,
    transform: Option<Transform>,
) -> RECT {
    let rect = source_rect(
        frame_w as f64,
        frame_h as f64,
        width as f64,
        height as f64,
        transform.unwrap_or_default(),
    );
    RECT {
        left: rect.0.round().max(0.0) as i32,
        top: rect.1.round().max(0.0) as i32,
        right: (rect.0 + rect.2).round().min(frame_w as f64) as i32,
        bottom: (rect.1 + rect.3).round().min(frame_h as f64) as i32,
    }
}

/// 拼接模式：把虚拟桌面的可见区域映射到当前显示器对应的源像素
fn span_source(
    frame_w: u32,
    frame_h: u32,
    monitor: Bounds,
    virtual_bounds: Bounds,
    transform: Option<Transform>,
) -> RECT {
    let vw = virtual_bounds.width().max(1) as f64;
    let vh = virtual_bounds.height().max(1) as f64;
    let (rx, ry, rw, _) = source_rect(
        frame_w as f64,
        frame_h as f64,
        vw,
        vh,
        transform.unwrap_or_default(),
    );
    let scale = (vw / rw.max(1.0)).max(f64::EPSILON);
    let ox = (monitor.left - virtual_bounds.left) as f64;
    let oy = (monitor.top - virtual_bounds.top) as f64;
    RECT {
        left: (rx + ox / scale).round().max(0.0) as i32,
        top: (ry + oy / scale).round().max(0.0) as i32,
        right: (rx + (ox + monitor.width() as f64) / scale)
            .round()
            .min(frame_w as f64) as i32,
        bottom: (ry + (oy + monitor.height() as f64) / scale)
            .round()
            .min(frame_h as f64) as i32,
    }
}

static MF_READY: std::sync::Once = std::sync::Once::new();

fn ensure_mf() {
    MF_READY.call_once(|| {
        // SAFETY: 媒体运行时每进程只启动一次
        unsafe {
            let _ = MFStartup(MF_VERSION, MFSTARTUP_FULL);
        }
    });
}

unsafe fn create_host(bounds: Bounds) -> Result<HWND, String> {
    let progman =
        FindWindowW(w!("Progman"), PCWSTR::null()).map_err(|_| "桌面窗口不可用".to_string())?;
    // 只在桌面层缺失时唤醒一次；反复广播会触发桌面重绘并闪出静态壁纸
    let worker = match FindWindowExW(Some(progman), None, w!("WorkerW"), PCWSTR::null()) {
        Ok(worker) => worker,
        Err(_) => {
            nudge_worker(progman.0 as isize);
            FindWindowExW(Some(progman), None, w!("WorkerW"), PCWSTR::null()).unwrap_or(progman)
        }
    };

    let mut parent = RECT::default();
    GetWindowRect(worker, &mut parent).map_err(|_| "桌面层不可用".to_string())?;

    let module = GetModuleHandleW(None).map_err(|_| "模块句柄不可用".to_string())?;
    let hwnd = CreateWindowExW(
        WS_EX_NOACTIVATE,
        w!("Static"),
        PCWSTR::null(),
        WS_CHILD | WS_CLIPSIBLINGS,
        bounds.left - parent.left,
        bounds.top - parent.top,
        bounds.width().max(1),
        bounds.height().max(1),
        Some(worker),
        None,
        Some(HINSTANCE(module.0)),
        None,
    )
    .map_err(|error| format!("壁纸窗口创建失败：{error}"))?;
    // SAFETY: 新实例排在旧实例之上，揭示时旧画面保持可见
    let _ = SetWindowPos(
        hwnd,
        Some(HWND_TOP),
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
    );
    Ok(hwnd)
}

#[link(name = "user32")]
extern "system" {
    fn SendMessageTimeoutW(
        hwnd: isize,
        msg: u32,
        wparam: usize,
        lparam: isize,
        flags: u32,
        timeout: u32,
        result: *mut usize,
    ) -> isize;
}

fn nudge_worker(progman: isize) {
    // SAFETY: 仅向 Progman 广播系统消息，确保 WorkerW 存在
    unsafe {
        SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 3000, std::ptr::null_mut());
    }
}





