//! 文件拖放：OLE 拖放目标统一接管窗口，提供系统缩略图与落点判定，
//! 并提供把格子文件拖出到资源管理器的拖放源。

#![allow(non_snake_case)]

use std::collections::HashMap;
use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

pub const EVENT_NAME: &str = "file-dropped";

const S_OK: i32 = 0;
const CLSCTX_INPROC_SERVER: u32 = 1;
const DROPEFFECT_NONE: u32 = 0;
const DROPEFFECT_COPY: u32 = 1;
const CF_HDROP: u16 = 15;
const DVASPECT_CONTENT: u32 = 1;
const TYMED_HGLOBAL: u32 = 1;
const DRAGDROP_S_DROP: i32 = 0x0004_0100;
const DRAGDROP_S_CANCEL: i32 = 0x0004_0101;
const DRAGDROP_S_USEDEFAULTCURSORS: i32 = 0x0004_0102;
const MK_LBUTTON: u32 = 0x0001;
const MK_RBUTTON: u32 = 0x0002;
const VK_LBUTTON: i32 = 0x01;
const VK_RBUTTON: i32 = 0x02;

#[repr(C)]
#[derive(Clone, Copy, PartialEq)]
struct Guid {
    d1: u32,
    d2: u16,
    d3: u16,
    d4: [u8; 8],
}

const IID_UNKNOWN: Guid = Guid { d1: 0, d2: 0, d3: 0, d4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46] };
const IID_DROP_TARGET: Guid = Guid { d1: 0x0000_0122, d2: 0, d3: 0, d4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46] };
const IID_DROP_SOURCE: Guid = Guid { d1: 0x0000_0121, d2: 0, d3: 0, d4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46] };
const IID_DATA_OBJECT: Guid = Guid { d1: 0x0000_010E, d2: 0, d3: 0, d4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46] };
const IID_SHELL_FOLDER: Guid = Guid { d1: 0x0002_14E6, d2: 0, d3: 0, d4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46] };
const IID_DROP_TARGET_HELPER: Guid =
    Guid { d1: 0x4657_278B, d2: 0x411B, d3: 0x11D2, d4: [0x83, 0x9A, 0x00, 0xC0, 0x4F, 0xD9, 0x18, 0xD0] };
// 拖拽图像与落点缩略图由同一个类实现，按 IID 取到不同接口
const CLSID_DRAG_DROP_HELPER: Guid =
    Guid { d1: 0x4657_278A, d2: 0x411B, d3: 0x11D2, d4: [0x83, 0x9A, 0x00, 0xC0, 0x4F, 0xD9, 0x18, 0xD0] };
const IID_DRAG_SOURCE_HELPER: Guid =
    Guid { d1: 0xDE5B_F786, d2: 0x477A, d3: 0x11D2, d4: [0x83, 0x9D, 0x00, 0xC0, 0x4F, 0xD9, 0x18, 0xD0] };

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct PointL {
    x: i32,
    y: i32,
}

#[repr(C)]
struct FormatEtc {
    cf_format: u16,
    ptd: *mut c_void,
    dw_aspect: u32,
    lindex: i32,
    tymed: u32,
}

#[repr(C)]
#[derive(Default)]
struct StgMedium {
    tymed: u32,
    data: *mut c_void,
    unk: *mut c_void,
}

/// 拖放接受区域，坐标为窗口客户区物理像素。
#[derive(Clone, Deserialize)]
pub struct Zone {
    pub id: String,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

impl Zone {
    fn hit(&self, x: f64, y: f64) -> bool {
        x >= self.left && x <= self.left + self.width && y >= self.top && y <= self.top + self.height
    }
}

/// 一个顶层窗口可能注册多个拖放目标，接受区域按窗口标签共享。
fn zones() -> &'static Mutex<HashMap<String, Arc<Mutex<Vec<Zone>>>>> {
    static ZONES: OnceLock<Mutex<HashMap<String, Arc<Mutex<Vec<Zone>>>>>> = OnceLock::new();
    ZONES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 取窗口的接受区域容器，注册与下发共用同一份，先到先创建。
fn zone_slot(label: &str) -> Arc<Mutex<Vec<Zone>>> {
    let mut map = zones().lock().unwrap_or_else(|error| error.into_inner());
    map.entry(label.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(Vec::new())))
        .clone()
}

/// 更新某个窗口的接受区域，窗口尚未注册时也会保留，注册时接上。
pub fn set_zones(label: &str, list: Vec<Zone>) {
    let slot = zone_slot(label);
    *slot.lock().unwrap_or_else(|error| error.into_inner()) = list;
}

#[repr(C)]
struct DropTarget {
    vtbl: *const DropTargetVtbl,
    refs: AtomicU32,
    app: AppHandle,
    label: String,
    /// 顶层窗口，客户端坐标换算与缩略图定位都以它为基准
    window: isize,
    zones: Arc<Mutex<Vec<Zone>>>,
    entered: AtomicBool,
    helper: Mutex<Option<isize>>,
}

#[repr(C)]
struct DropTargetVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    drag_enter: unsafe extern "system" fn(*mut c_void, *mut c_void, u32, PointL, *mut u32) -> i32,
    drag_over: unsafe extern "system" fn(*mut c_void, u32, PointL, *mut u32) -> i32,
    drag_leave: unsafe extern "system" fn(*mut c_void) -> i32,
    drop: unsafe extern "system" fn(*mut c_void, *mut c_void, u32, PointL, *mut u32) -> i32,
}

/// 方法顺序按 shobjidl.h：DragEnter、DragLeave、DragOver、Drop、Show
#[repr(C)]
struct DropTargetHelperVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    drag_enter: unsafe extern "system" fn(*mut c_void, isize, *mut c_void, *const PointL, u32) -> i32,
    drag_leave: unsafe extern "system" fn(*mut c_void) -> i32,
    drag_over: unsafe extern "system" fn(*mut c_void, *const PointL, u32) -> i32,
    drop: unsafe extern "system" fn(*mut c_void, *mut c_void, *const PointL, u32) -> i32,
    show: unsafe extern "system" fn(*mut c_void, i32) -> i32,
}

/// 只用到 IDataObject 的 GetData。
#[repr(C)]
struct DataObjectVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    get_data: unsafe extern "system" fn(*mut c_void, *const FormatEtc, *mut StgMedium) -> i32,
    get_data_here: unsafe extern "system" fn(*mut c_void, *const FormatEtc, *mut StgMedium) -> i32,
    query_get_data: unsafe extern "system" fn(*mut c_void, *const FormatEtc) -> i32,
}

#[repr(C)]
struct DropSource {
    vtbl: *const DropSourceVtbl,
    refs: AtomicU32,
    /// 首次查询时按键已经抬起说明是误触发，直接取消避免凭空落一份文件
    armed: AtomicBool,
}

#[repr(C)]
struct DropSourceVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    query_continue_drag: unsafe extern "system" fn(*mut c_void, i32, u32) -> i32,
    give_feedback: unsafe extern "system" fn(*mut c_void, u32) -> i32,
}

#[repr(C)]
struct DragSourceHelperVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    initialize_from_bitmap: unsafe extern "system" fn(*mut c_void, *const ShDragImage, *mut c_void) -> i32,
}

#[repr(C)]
struct Size {
    cx: i32,
    cy: i32,
}

#[repr(C)]
struct ShDragImage {
    size: Size,
    offset: PointL,
    image: isize,
    color_key: u32,
}

#[repr(C)]
struct BitmapInfoHeader {
    size: u32,
    width: i32,
    height: i32,
    planes: u16,
    bit_count: u16,
    compression: u32,
    size_image: u32,
    x_ppm: i32,
    y_ppm: i32,
    clr_used: u32,
    clr_important: u32,
}

#[repr(C)]
struct BitmapInfo {
    header: BitmapInfoHeader,
    colors: [u32; 1],
}

#[link(name = "ole32")]
extern "system" {
    fn OleInitialize(reserved: *mut c_void) -> i32;
    fn OleUninitialize();
    fn CoCreateInstance(class: *const Guid, outer: *mut c_void, context: u32, iid: *const Guid, out: *mut *mut c_void) -> i32;
    fn CoTaskMemFree(ptr: *mut c_void);
    fn ReleaseStgMedium(medium: *mut StgMedium);
    fn RegisterDragDrop(hwnd: isize, target: *mut c_void) -> i32;
    fn RevokeDragDrop(hwnd: isize) -> i32;
    fn DoDragDrop(data: *mut c_void, source: *mut c_void, effects: u32, out: *mut u32) -> i32;
}

#[link(name = "shell32")]
extern "system" {
    fn DragQueryFileW(drop: isize, file: u32, buffer: *mut u16, size: u32) -> u32;
    fn SHParseDisplayName(name: *const u16, attributes: *mut c_void, pidl: *mut *mut c_void, flags: u32, eaten: *mut u32) -> i32;
    fn SHCreateDataObject(
        folder: *mut c_void,
        count: u32,
        items: *const *mut c_void,
        inner: *mut c_void,
        iid: *const Guid,
        out: *mut *mut c_void,
    ) -> i32;
    fn SHBindToParent(pidl: *const c_void, iid: *const Guid, out: *mut *mut c_void, child: *mut *mut c_void) -> i32;
    fn SHGetIDListFromObject(object: *mut c_void, pidl: *mut *mut c_void) -> i32;
}

#[link(name = "user32")]
extern "system" {
    fn EnumChildWindows(hwnd: isize, callback: Option<unsafe extern "system" fn(isize, isize) -> i32>, context: isize) -> i32;
    fn ScreenToClient(hwnd: isize, point: *mut PointL) -> i32;
    fn GetAsyncKeyState(key: i32) -> i16;
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateDIBSection(dc: isize, info: *const BitmapInfo, usage: u32, bits: *mut *mut c_void, section: isize, offset: u32) -> isize;
    fn DeleteObject(object: isize) -> i32;
}

/// 把窗口及其子窗口交给自定义拖放目标，先撤掉已有的（wry 注册的）。
/// WebView2 的拖放落点挂在子窗口上，只注册顶层窗口收不到任何事件。
pub fn install(app: &AppHandle, label: &str, hwnd: isize) {
    if hwnd == 0 {
        return;
    }

    // SAFETY: 顶层窗口在本线程创建，OLE 也在这里初始化
    unsafe {
        OleInitialize(ptr::null_mut());
    }

    let context = InstallContext {
        app: app.clone(),
        label: label.to_string(),
        window: hwnd,
        zones: zone_slot(label),
    };

    register(&context, hwnd);
    // SAFETY: 回调只读取栈上的 context，枚举期间一直有效
    unsafe {
        EnumChildWindows(hwnd, Some(register_child), &context as *const InstallContext as isize);
    }
}

struct InstallContext {
    app: AppHandle,
    label: String,
    window: isize,
    zones: Arc<Mutex<Vec<Zone>>>,
}

unsafe extern "system" fn register_child(child: isize, context: isize) -> i32 {
    // SAFETY: 由 install 传入，枚举期间有效
    let context = &*(context as *const InstallContext);
    register(context, child);
    1
}

fn register(context: &InstallContext, hwnd: isize) {
    let mut helper = ptr::null_mut();

    // SAFETY: 撤掉已有目标后接管该窗口的拖放
    unsafe {
        RevokeDragDrop(hwnd);
        CoCreateInstance(&CLSID_DRAG_DROP_HELPER, ptr::null_mut(), CLSCTX_INPROC_SERVER, &IID_DROP_TARGET_HELPER, &mut helper);
    }

    let target = Box::into_raw(Box::new(DropTarget {
        vtbl: &DROP_TARGET_VTBL,
        refs: AtomicU32::new(1),
        app: context.app.clone(),
        label: context.label.clone(),
        window: context.window,
        zones: context.zones.clone(),
        entered: AtomicBool::new(false),
        helper: Mutex::new(if helper.is_null() { None } else { Some(helper as isize) }),
    })) as *mut c_void;

    // SAFETY: 目标对象随窗口存活，注册失败时归还自己持有的引用
    let registered = unsafe { RegisterDragDrop(hwnd, target) } >= 0;
    if !registered {
        unsafe { ((*(target as *const DropTarget)).vtbl.as_ref().unwrap().release)(target) };
    }
}

/// 把所有应用窗口接上拖放目标，落点为空即只显示缩略图。
pub fn install_all(app: &AppHandle) {
    use tauri::Manager;

    for (label, window) in app.webview_windows() {
        if matches!(label.as_str(), "hud" | "tooltip" | "overlay") {
            continue;
        }
        if let Ok(hwnd) = window.hwnd() {
            install(app, &label, hwnd.0 as isize);
        }
    }
}

static DROP_TARGET_VTBL: DropTargetVtbl = DropTargetVtbl {
    query_interface: target_query_interface,
    add_ref: target_add_ref,
    release: target_release,
    drag_enter: target_drag_enter,
    drag_over: target_drag_over,
    drag_leave: target_drag_leave,
    drop: target_drop,
};

fn target_of<'a>(this: *mut c_void) -> &'a DropTarget {
    unsafe { &*(this as *const DropTarget) }
}

unsafe extern "system" fn target_query_interface(this: *mut c_void, iid: *const Guid, out: *mut *mut c_void) -> i32 {
    if iid.is_null() || out.is_null() {
        return -1;
    }
    let iid = *iid;
    if iid == IID_UNKNOWN || iid == IID_DROP_TARGET {
        *out = this;
        target_add_ref(this);
        S_OK
    } else {
        *out = ptr::null_mut();
        -1
    }
}

unsafe extern "system" fn target_add_ref(this: *mut c_void) -> u32 {
    target_of(this).refs.fetch_add(1, Ordering::SeqCst) + 1
}

unsafe extern "system" fn target_release(this: *mut c_void) -> u32 {
    let target = target_of(this);
    let left = target.refs.fetch_sub(1, Ordering::SeqCst) - 1;
    if left == 0 {
        if let Some(helper) = *target.helper.lock().unwrap_or_else(|error| error.into_inner()) {
            drop_helper_release(helper);
        }
        drop(Box::from_raw(this as *mut DropTarget));
    }
    left
}

fn drop_helper_release(helper: isize) {
    unsafe {
        let vtbl = *(helper as *const *const DropTargetHelperVtbl);
        ((*vtbl).release)(helper as *mut c_void);
    }
}

fn helper_of(target: &DropTarget) -> Option<isize> {
    *target.helper.lock().unwrap()
}

fn hit_zone(target: &DropTarget, point: &PointL) -> Option<String> {
    let list = target.zones.lock().ok()?;
    let x = point.x as f64;
    let y = point.y as f64;
    list.iter().find(|zone| zone.hit(x, y)).map(|zone| zone.id.clone())
}

unsafe extern "system" fn target_drag_enter(this: *mut c_void, data: *mut c_void, _keys: u32, point: PointL, effect: *mut u32) -> i32 {
    let target = target_of(this);
    let mut client = point;
    ScreenToClient(target.window, &mut client);

    let has_files = !read_paths(data).map(|paths| paths.is_empty()).unwrap_or(true);
    target.entered.store(has_files, Ordering::SeqCst);

    let zone = if has_files { hit_zone(target, &client) } else { None };
    let drop_effect = if zone.is_some() { DROPEFFECT_COPY } else { DROPEFFECT_NONE };
    if !effect.is_null() {
        *effect = drop_effect;
    }

    if let Some(helper) = helper_of(target) {
        let vtbl = *(helper as *const *const DropTargetHelperVtbl);
        ((*vtbl).drag_enter)(helper as *mut c_void, target.window, data, &point, drop_effect);
    }
    S_OK
}

unsafe extern "system" fn target_drag_over(this: *mut c_void, _keys: u32, point: PointL, effect: *mut u32) -> i32 {
    let target = target_of(this);
    let mut client = point;
    ScreenToClient(target.window, &mut client);

    let zone = if target.entered.load(Ordering::SeqCst) { hit_zone(target, &client) } else { None };
    let drop_effect = if zone.is_some() { DROPEFFECT_COPY } else { DROPEFFECT_NONE };
    if !effect.is_null() {
        *effect = drop_effect;
    }

    if let Some(helper) = helper_of(target) {
        let vtbl = *(helper as *const *const DropTargetHelperVtbl);
        ((*vtbl).drag_over)(helper as *mut c_void, &point, drop_effect);
    }
    S_OK
}

unsafe extern "system" fn target_drag_leave(this: *mut c_void) -> i32 {
    let target = target_of(this);
    target.entered.store(false, Ordering::SeqCst);

    if let Some(helper) = helper_of(target) {
        let vtbl = *(helper as *const *const DropTargetHelperVtbl);
        ((*vtbl).drag_leave)(helper as *mut c_void);
    }
    S_OK
}

unsafe extern "system" fn target_drop(this: *mut c_void, data: *mut c_void, _keys: u32, point: PointL, effect: *mut u32) -> i32 {
    let target = target_of(this);
    target.entered.store(false, Ordering::SeqCst);

    let mut client = point;
    ScreenToClient(target.window, &mut client);
    let zone = hit_zone(target, &client);
    let paths = read_paths(data).unwrap_or_default();

    let drop_effect = if zone.is_some() && !paths.is_empty() { DROPEFFECT_COPY } else { DROPEFFECT_NONE };
    if !effect.is_null() {
        *effect = drop_effect;
    }

    if let Some(helper) = helper_of(target) {
        let vtbl = *(helper as *const *const DropTargetHelperVtbl);
        ((*vtbl).drop)(helper as *mut c_void, data, &point, drop_effect);
    }

    if let Some(zone) = zone {
        if !paths.is_empty() {
            let _ = target.app.emit(
                EVENT_NAME,
                serde_json::json!({
                    "window": target.label,
                    "zone": zone,
                    "paths": paths,
                    "x": client.x,
                    "y": client.y,
                }),
            );
        }
    }
    S_OK
}

/// 读取 CF_HDROP 文件列表，非文件拖放返回 None。
unsafe fn read_paths(data: *mut c_void) -> Option<Vec<String>> {
    if data.is_null() {
        return None;
    }

    let vtbl = *(data as *const *const DataObjectVtbl);
    let format = FormatEtc {
        cf_format: CF_HDROP,
        ptd: ptr::null_mut(),
        dw_aspect: DVASPECT_CONTENT,
        lindex: -1,
        tymed: TYMED_HGLOBAL,
    };
    let mut medium = StgMedium::default();
    if ((*vtbl).get_data)(data, &format, &mut medium) < 0 {
        return None;
    }

    let drop = medium.data as isize;
    let count = DragQueryFileW(drop, u32::MAX, ptr::null_mut(), 0);
    let mut paths = Vec::new();
    for index in 0..count {
        let length = DragQueryFileW(drop, index, ptr::null_mut(), 0);
        if length == 0 {
            continue;
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let written = DragQueryFileW(drop, index, buffer.as_mut_ptr(), buffer.len() as u32);
        if written > 0 {
            paths.push(String::from_utf16_lossy(&buffer[..written as usize]));
        }
    }

    ReleaseStgMedium(&mut medium);
    Some(paths)
}

/// 把格子文件拖到窗口外，向系统发起拖放，只复制文件本身。
/// OLE 拖放会接管鼠标直到松手，必须在有消息循环的线程上调用，期间会被阻塞。
/// 返回是否已在别处放下一份副本，调用方据此清空格子。
pub fn begin_file_drag(path: String, size: u32) -> bool {
    // 发起侧在主线程，这里的按键状态可靠，用来判断是不是真的按着拖
    let pressed = button_down();
    // SAFETY: 调用线程已初始化 OLE，拖放结束后自行释放
    unsafe { drag_out(&path, size, pressed) }
}

fn button_down() -> bool {
    // SAFETY: 只读全局键态
    unsafe { GetAsyncKeyState(VK_LBUTTON) & 0x8000u16 as i16 != 0 || GetAsyncKeyState(VK_RBUTTON) & 0x8000u16 as i16 != 0 }
}

/// 以父文件夹加子项的方式创建拖放数据对象，文件项才会提供 CF_HDROP。
unsafe fn create_data_object(path: &str) -> Option<*mut c_void> {
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut full: *mut c_void = ptr::null_mut();
    if SHParseDisplayName(wide.as_ptr(), ptr::null_mut(), &mut full, 0, ptr::null_mut()) < 0 {
        return None;
    }

    // 子项 PIDL 指向完整 PIDL 内部，必须等数据对象创建完再释放
    let mut folder: *mut c_void = ptr::null_mut();
    let mut child: *mut c_void = ptr::null_mut();
    let mut folder_pidl: *mut c_void = ptr::null_mut();
    let mut data: *mut c_void = ptr::null_mut();

    let bound = SHBindToParent(full, &IID_SHELL_FOLDER, &mut folder, &mut child);
    if bound >= 0 && !folder.is_null() && !child.is_null() {
        let listed = SHGetIDListFromObject(folder, &mut folder_pidl);
        if listed >= 0 && !folder_pidl.is_null() {
            SHCreateDataObject(folder_pidl, 1, &child, ptr::null_mut(), &IID_DATA_OBJECT, &mut data);
        }
    }

    if !folder.is_null() {
        let folder_vtbl = *(folder as *const *const DataObjectVtbl);
        ((*folder_vtbl).release)(folder);
    }
    if !folder_pidl.is_null() {
        CoTaskMemFree(folder_pidl);
    }
    CoTaskMemFree(full);

    if data.is_null() {
        None
    } else {
        Some(data)
    }
}

struct DragSession {
    data: *mut c_void,
    source: *mut c_void,
    helper: Option<isize>,
    bitmap: Option<isize>,
}

/// 组装系统拖放数据和拖拽图像，调用方负责 DoDragDrop 后收尾。
unsafe fn prepare(path: &str, size: u32, pressed: bool) -> Option<DragSession> {
    let data = create_data_object(path)?;

    let helper = create_source_helper();
    let image = make_drag_image(path, size);
    if let (Some(helper), Some((bitmap, width, height))) = (helper, &image) {
        let picture = ShDragImage {
            size: Size { cx: *width as i32, cy: *height as i32 },
            offset: PointL { x: *width as i32 / 2, y: *height as i32 / 2 },
            image: *bitmap,
            color_key: 0xFFFF_FFFF,
        };
        let vtbl = *(helper as *const *const DragSourceHelperVtbl);
        ((*vtbl).initialize_from_bitmap)(helper as *mut c_void, &picture, data);
    }

    let source = Box::into_raw(Box::new(DropSource {
        vtbl: &DROP_SOURCE_VTBL,
        refs: AtomicU32::new(1),
        armed: AtomicBool::new(pressed),
    })) as *mut c_void;

    Some(DragSession { data, source, helper, bitmap: image.map(|(bitmap, _, _)| bitmap) })
}

unsafe fn release(session: DragSession) {
    let source_vtbl = *(session.source as *const *const DropSourceVtbl);
    ((*source_vtbl).release)(session.source);

    let data_vtbl = *(session.data as *const *const DataObjectVtbl);
    ((*data_vtbl).release)(session.data);

    if let Some(bitmap) = session.bitmap {
        DeleteObject(bitmap);
    }
    if let Some(helper) = session.helper {
        let vtbl = *(helper as *const *const DragSourceHelperVtbl);
        ((*vtbl).release)(helper as *mut c_void);
    }
}

/// 发起系统拖放，返回文件是否已经被放到别处。取消时返回 false。
/// 只提供复制，原路径文件不动；落点为复制时调用方清空格子。
unsafe fn drag_out(path: &str, size: u32, pressed: bool) -> bool {
    if OleInitialize(ptr::null_mut()) < 0 {
        return false;
    }

    let mut dropped = false;
    if let Some(session) = prepare(path, size, pressed) {
        let mut effect = DROPEFFECT_COPY;
        DoDragDrop(session.data, session.source, DROPEFFECT_COPY, &mut effect);
        dropped = effect & DROPEFFECT_COPY != 0;
        release(session);
    }

    OleUninitialize();
    dropped
}

unsafe fn create_source_helper() -> Option<isize> {
    let mut helper: *mut c_void = ptr::null_mut();
    let hr = CoCreateInstance(&CLSID_DRAG_DROP_HELPER, ptr::null_mut(), CLSCTX_INPROC_SERVER, &IID_DRAG_SOURCE_HELPER, &mut helper);
    if hr < 0 || helper.is_null() {
        None
    } else {
        Some(helper as isize)
    }
}

/// 用格子图标生成拖拽图像，返回位图与尺寸。
unsafe fn make_drag_image(path: &str, size: u32) -> Option<(isize, u32, u32)> {
    let bytes = crate::icons::slot_icon_bytes(path, false)?;
    let image = image::load_from_memory(&bytes).ok()?.to_rgba8();
    let side = size.clamp(1, 256);
    let resized = image::imageops::resize(&image, side, side, image::imageops::FilterType::Lanczos3);

    let mut pixels = Vec::with_capacity((side * side) as usize);
    for pixel in resized.as_raw().chunks_exact(4) {
        let alpha = pixel[3] as u32;
        let red = pixel[0] as u32 * alpha / 255;
        let green = pixel[1] as u32 * alpha / 255;
        let blue = pixel[2] as u32 * alpha / 255;
        pixels.push((alpha << 24) | (red << 16) | (green << 8) | blue);
    }

    let info = BitmapInfo {
        header: BitmapInfoHeader {
            size: std::mem::size_of::<BitmapInfoHeader>() as u32,
            width: side as i32,
            height: -(side as i32),
            planes: 1,
            bit_count: 32,
            compression: 0,
            size_image: (side * side * 4) as u32,
            x_ppm: 0,
            y_ppm: 0,
            clr_used: 0,
            clr_important: 0,
        },
        colors: [0],
    };

    let mut bits: *mut c_void = ptr::null_mut();
    let bitmap = CreateDIBSection(0, &info, 0, &mut bits, 0, 0);
    if bitmap == 0 || bits.is_null() {
        return None;
    }
    ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u32, pixels.len());

    Some((bitmap, side, side))
}

static DROP_SOURCE_VTBL: DropSourceVtbl = DropSourceVtbl {
    query_interface: source_query_interface,
    add_ref: source_add_ref,
    release: source_release,
    query_continue_drag: source_query_continue_drag,
    give_feedback: source_give_feedback,
};

unsafe extern "system" fn source_query_interface(this: *mut c_void, iid: *const Guid, out: *mut *mut c_void) -> i32 {
    if iid.is_null() || out.is_null() {
        return -1;
    }
    if *iid == IID_UNKNOWN || *iid == IID_DROP_SOURCE {
        *out = this;
        source_add_ref(this);
        S_OK
    } else {
        *out = ptr::null_mut();
        -1
    }
}

unsafe extern "system" fn source_add_ref(this: *mut c_void) -> u32 {
    let source = &*(this as *const DropSource);
    source.refs.fetch_add(1, Ordering::SeqCst) + 1
}

unsafe extern "system" fn source_release(this: *mut c_void) -> u32 {
    let source = &*(this as *const DropSource);
    let left = source.refs.fetch_sub(1, Ordering::SeqCst) - 1;
    if left == 0 {
        drop(Box::from_raw(this as *mut DropSource));
    }
    left
}

unsafe extern "system" fn source_query_continue_drag(this: *mut c_void, escape: i32, keys: u32) -> i32 {
    if escape != 0 {
        return DRAGDROP_S_CANCEL;
    }

    let source = &*(this as *const DropSource);
    // 两个来源任意一个显示还按着就继续，避免某个线程读到过期键态导致拖拽一开始就中断
    let held = keys & (MK_LBUTTON | MK_RBUTTON) != 0 || button_down();
    if !held {
        // 发起时就没按着，说明是误触发，取消而不是落点
        return if source.armed.load(Ordering::SeqCst) { DRAGDROP_S_DROP } else { DRAGDROP_S_CANCEL };
    }
    source.armed.store(true, Ordering::SeqCst);
    S_OK
}

unsafe extern "system" fn source_give_feedback(_this: *mut c_void, _effect: u32) -> i32 {
    DRAGDROP_S_USEDEFAULTCURSORS
}

#[cfg(test)]
mod tests {
    use super::*;

    /// OLE 是单线程模型，测试串行执行，避免并行初始化互相干扰
    fn ole_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap_or_else(|error| error.into_inner())
    }

    /// 组装拖放源的全部 COM 组件，并确认数据对象能读回文件路径。
    #[test]
    fn prepare_drag_session_round_trip() {
        let _guard = ole_lock();
        let path = std::env::temp_dir().join("craftsharp-drag-test.txt");
        std::fs::write(&path, b"test").unwrap();
        let path = path.to_string_lossy().to_string();

        unsafe {
            assert!(OleInitialize(ptr::null_mut()) >= 0);

            let session = prepare(&path, 32, true).expect("拖放数据准备失败");
            // 拖拽图像和缩略图助手缺一不可，否则拖出时没有跟随图标
            assert!(session.bitmap.is_some(), "拖拽图像生成失败");
            assert!(session.helper.is_some(), "拖拽图像助手创建失败");
            let vtbl = *(session.data as *const *const DataObjectVtbl);
            let format = FormatEtc {
                cf_format: CF_HDROP,
                ptd: ptr::null_mut(),
                dw_aspect: DVASPECT_CONTENT,
                lindex: -1,
                tymed: TYMED_HGLOBAL,
            };
            assert_eq!(((*vtbl).query_get_data)(session.data, &format), S_OK);
            let paths = read_paths(session.data).expect("数据对象读取失败");
            assert_eq!(paths.first().map(String::as_str), Some(path.as_str()));

            release(session);
            OleUninitialize();
        }
    }

    /// 缩略图助手按 shobjidl.h 的顺序调用：DragEnter 建图，DragOver 跟随，DragLeave 收尾。
    #[test]
    fn drop_target_helper_shows_drag_image() {
        let _guard = ole_lock();
        let path = std::env::temp_dir().join("craftsharp-thumb-test.txt");
        std::fs::write(&path, b"test").unwrap();

        unsafe {
            assert!(OleInitialize(ptr::null_mut()) >= 0);

            let session = prepare(&path.to_string_lossy(), 32, true).expect("拖放数据准备失败");
            let mut helper: *mut c_void = ptr::null_mut();
            let hr = CoCreateInstance(&CLSID_DRAG_DROP_HELPER, ptr::null_mut(), CLSCTX_INPROC_SERVER, &IID_DROP_TARGET_HELPER, &mut helper);
            assert!(hr >= 0 && !helper.is_null());

            let vtbl = *(helper as *const *const DropTargetHelperVtbl);
            let mut point = PointL { x: 100, y: 100 };
            assert!(((*vtbl).drag_enter)(helper, 0, session.data, &point, DROPEFFECT_COPY) >= 0, "DragEnter 失败");
            point = PointL { x: 120, y: 120 };
            assert!(((*vtbl).drag_over)(helper, &point, DROPEFFECT_COPY) >= 0, "DragOver 失败");
            point = PointL { x: 130, y: 130 };
            assert!(((*vtbl).drag_over)(helper, &point, DROPEFFECT_COPY) >= 0, "DragOver 第二次失败");
            assert!(((*vtbl).drag_leave)(helper) >= 0, "DragLeave 失败");
            ((*vtbl).release)(helper);

            release(session);
            OleUninitialize();
        }
    }
}
