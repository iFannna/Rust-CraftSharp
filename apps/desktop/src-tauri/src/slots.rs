//! 格子数据：Rust 侧唯一写入者，快捷栏与物品栏共用。
//!
//! 跨窗口拖放由本模块一次完成「目标格写入 + 源格清空」，两个窗口不再各写一份
//! 整表快照，避免后写的一方用旧副本覆盖掉另一方的修改。所有通知都在释放存储锁
//! 之后触发，窗口重绘时再读数据不会死锁。

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Clone, PartialEq, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlotItem {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

/// 格子作用域：共享模式忽略样式，独立模式按容器样式隔离。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scope {
    pub style: String,
    pub shared: bool,
}

impl Scope {
    pub fn hotbar() -> Scope {
        Scope { style: "inventory.png".to_string(), shared: true }
    }

    pub fn new(style: impl Into<String>, shared: bool) -> Scope {
        Scope { style: style.into(), shared }
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Data {
    #[serde(default)]
    rev: u64,
    #[serde(default)]
    slots: BTreeMap<String, SlotItem>,
    #[serde(default)]
    style_slots: BTreeMap<String, BTreeMap<String, SlotItem>>,
}

/// 广播给前端的完整快照，窗口只读。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub rev: u64,
    pub slots: BTreeMap<String, SlotItem>,
    pub style_slots: BTreeMap<String, BTreeMap<String, SlotItem>>,
}

struct Store {
    data: Data,
    path: Option<PathBuf>,
    app: Option<AppHandle>,
    /// 窗口标签对应的读取作用域，物品栏按当前样式与共享开关注册。
    scopes: HashMap<String, Scope>,
    /// 首次启动且没有数据文件时允许从旧 localStorage 导入一次。
    import_allowed: bool,
}

type Refresh = Arc<dyn Fn() + Send + Sync>;

fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(|| {
        let mut scopes = HashMap::new();
        scopes.insert("hud".to_string(), Scope::hotbar());
        Mutex::new(Store {
            data: Data::default(),
            path: None,
            app: None,
            scopes,
            import_allowed: false,
        })
    })
}

fn refresh_hooks() -> &'static Mutex<Vec<Refresh>> {
    static HOOKS: OnceLock<Mutex<Vec<Refresh>>> = OnceLock::new();
    HOOKS.get_or_init(|| Mutex::new(Vec::new()))
}

fn with_store<T>(f: impl FnOnce(&mut Store) -> T) -> T {
    let mut guard = store().lock().unwrap_or_else(|error| error.into_inner());
    f(&mut guard)
}

/// 原生窗口注册数据变化后的重绘回调。
pub fn on_changed(hook: impl Fn() + Send + Sync + 'static) {
    refresh_hooks()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .push(Arc::new(hook));
}

pub fn init(app: &AppHandle, path: PathBuf) {
    let existed = path.exists();
    let data = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Data>(&bytes).ok())
        .unwrap_or_default();

    with_store(|store| {
        store.import_allowed = !existed || (data.slots.is_empty() && data.style_slots.is_empty());
        store.data = data;
        store.path = Some(path);
        store.app = Some(app.clone());
    });
}

fn persist(data: &Data, path: Option<&PathBuf>) {
    let Some(path) = path else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(data) {
        // 先写临时文件再替换，避免掉电或崩溃留下半截 JSON
        let temporary = path.with_extension("json.tmp");
        if fs::write(&temporary, bytes).is_ok() {
            let _ = fs::rename(&temporary, path);
        }
    }
}

fn snapshot_of(data: &Data) -> Snapshot {
    Snapshot {
        rev: data.rev,
        slots: data.slots.clone(),
        style_slots: data.style_slots.clone(),
    }
}

pub fn snapshot() -> Snapshot {
    with_store(|store| snapshot_of(&store.data))
}

/// 清除数据后清空内存格子并移除数据文件；不重新落盘，等下次写入再生成。
pub fn reset() {
    let (payload, app) = {
        let mut guard = store().lock().unwrap_or_else(|error| error.into_inner());
        let rev = guard.data.rev.saturating_add(1);
        guard.data = Data {
            rev,
            ..Data::default()
        };
        guard.import_allowed = false;
        if let Some(path) = &guard.path {
            let _ = fs::remove_file(path);
        }
        (snapshot_of(&guard.data), guard.app.clone())
    };

    if let Some(app) = &app {
        let _ = app.emit("slots-changed", payload);
    }
    let hooks = refresh_hooks().lock().unwrap_or_else(|error| error.into_inner()).clone();
    for hook in hooks {
        hook();
    }
}

/// 修改数据；返回 true 时落盘并在锁外广播。
fn commit<T>(mutate: impl FnOnce(&mut Data) -> (T, bool)) -> T {
    let (result, payload, app) = {
        let mut guard = store().lock().unwrap_or_else(|error| error.into_inner());
        let (result, changed) = mutate(&mut guard.data);
        let payload = if changed {
            guard.data.rev = guard.data.rev.saturating_add(1);
            persist(&guard.data, guard.path.as_ref());
            Some(snapshot_of(&guard.data))
        } else {
            None
        };
        (result, payload, guard.app.clone())
    };

    if let Some(payload) = payload {
        if let Some(app) = &app {
            let _ = app.emit("slots-changed", payload);
        }
        let hooks = refresh_hooks().lock().unwrap_or_else(|error| error.into_inner()).clone();
        for hook in hooks {
            hook();
        }
    }
    result
}

fn map_for<'a>(data: &'a Data, scope: &Scope) -> Option<&'a BTreeMap<String, SlotItem>> {
    if scope.shared {
        Some(&data.slots)
    } else {
        data.style_slots.get(&scope.style)
    }
}

fn map_mut<'a>(data: &'a mut Data, scope: &Scope) -> &'a mut BTreeMap<String, SlotItem> {
    if scope.shared {
        &mut data.slots
    } else {
        data.style_slots.entry(scope.style.clone()).or_default()
    }
}

/// 去掉路径两侧的引号与空白，与图标解码的清洗规则保持一致。
fn clean(path: &str) -> String {
    path.trim().trim_matches('"').to_string()
}

pub fn get(scope: &Scope, slot_id: &str) -> Option<SlotItem> {
    with_store(|store| map_for(&store.data, scope).and_then(|map| map.get(slot_id).cloned()))
}

pub fn set(scope: &Scope, slot_id: &str, item: SlotItem) {
    commit(|data| {
        let map = map_mut(data, scope);
        if map.get(slot_id) == Some(&item) {
            return ((), false);
        }
        map.insert(slot_id.to_string(), item);
        ((), true)
    });
}

pub fn clear(scope: &Scope, slot_id: &str) {
    commit(|data| {
        let removed = map_mut(data, scope).remove(slot_id).is_some();
        ((), removed)
    });
}

/// 扫格时一次写入多个目标格，避免逐格落盘与广播。
pub fn set_many(scope: &Scope, items: Vec<(String, SlotItem)>) {
    if items.is_empty() {
        return;
    }
    commit(|data| {
        let map = map_mut(data, scope);
        for (id, item) in items {
            map.insert(id, item);
        }
        ((), true)
    });
}

/// 扫格丢弃时一次移除多个格子。
pub fn clear_many(scope: &Scope, ids: Vec<String>) {
    if ids.is_empty() {
        return;
    }
    commit(|data| {
        let map = map_mut(data, scope);
        let mut changed = false;
        for id in ids {
            changed |= map.remove(&id).is_some();
        }
        ((), changed)
    });
}

/// 同一作用域内搬移一个格子：清空源格与写入目标格一次提交。
pub fn move_to(scope: &Scope, from_id: &str, to_id: &str) -> bool {
    if from_id == to_id {
        return false;
    }
    commit(|data| {
        let map = map_mut(data, scope);
        let Some(item) = map.remove(from_id) else {
            return (false, false);
        };
        map.insert(to_id.to_string(), item);
        (true, true)
    })
}

/// 剪切粘贴搬移：源格与目标格可能属于不同作用域，清空源格与写入目标格一次提交，
/// 避免分步写入的旧快照回显闪出源格图标。源格数据缺失时按剪贴板内容写入目标格。
pub fn move_between(from_scope: &Scope, from_id: &str, to_scope: &Scope, to_id: &str, fallback: SlotItem) {
    if from_scope == to_scope && from_id == to_id {
        return;
    }
    commit(|data| {
        let item = map_for(data, from_scope)
            .and_then(|map| map.get(from_id).cloned())
            .unwrap_or(fallback);
        map_mut(data, to_scope).insert(to_id.to_string(), item);
        map_mut(data, from_scope).remove(from_id);
        ((), true)
    });
}

pub fn clear_by_path(scope: &Scope, path: &str) {
    commit(|data| {
        let map = map_mut(data, scope);
        let before = map.len();
        map.retain(|_, item| item.path != path);
        ((), map.len() != before)
    });
}

pub fn replace_path(scope: &Scope, from: &str, to: &str) {
    commit(|data| {
        let map = map_mut(data, scope);
        let mut touched = false;
        for item in map.values_mut() {
            if item.path == from {
                item.path = to.to_string();
                touched = true;
            }
        }
        ((), touched)
    });
}

pub fn swap(scope: &Scope, from_id: &str, to_id: &str) {
    if from_id == to_id {
        return;
    }
    commit(|data| {
        let map = map_mut(data, scope);
        let from = map.get(from_id).cloned();
        let to = map.get(to_id).cloned();
        match to {
            Some(item) => map.insert(from_id.to_string(), item),
            None => map.remove(from_id),
        };
        match from {
            Some(item) => map.insert(to_id.to_string(), item),
            None => map.remove(to_id),
        };
        ((), true)
    });
}

/// 外部文件拖入：直接写入目标格。
pub fn drop_paths(window: &str, slot_id: &str, path: &str) {
    let scope = scope_of(window);
    set(&scope, slot_id, SlotItem { path: clean(path), display_name: None });
}

/// 格子拖动落到另一个格子：源格数据搬到目标格并清空源格，一次提交。
/// 源数据缺失时按落点文件路径写入，和拖放数据对象保持一致。
pub fn move_slot(source_window: &str, source_id: &str, target_window: &str, target_id: &str, path: &str) {
    let source_scope = scope_of(source_window);
    let target_scope = scope_of(target_window);
    if source_scope == target_scope && source_id == target_id {
        return;
    }

    commit(|data| {
        let item = map_for(data, &source_scope)
            .and_then(|map| map.get(source_id).cloned())
            .unwrap_or(SlotItem { path: clean(path), display_name: None });

        map_mut(data, &target_scope).insert(target_id.to_string(), item);
        map_mut(data, &source_scope).remove(source_id);
        ((), true)
    });
}

pub fn register_scope(label: &str, style: &str, shared: bool) {
    with_store(|store| {
        store.scopes.insert(label.to_string(), Scope::new(style, shared));
    });
}

/// 窗口标签对应的格子作用域：快捷栏固定共享，物品栏按注册的样式与共享开关。
pub fn scope_of(label: &str) -> Scope {
    with_store(|store| store.scopes.get(label).cloned()).unwrap_or_else(Scope::hotbar)
}

/// 迁移入口：只在首次启动且没有数据文件时接受旧数据，返回是否导入。
pub fn import(
    slots: BTreeMap<String, SlotItem>,
    style_slots: BTreeMap<String, BTreeMap<String, SlotItem>>,
) -> bool {
    let allowed = with_store(|store| {
        if !store.import_allowed {
            return false;
        }
        store.import_allowed = false;
        true
    });
    if !allowed {
        return false;
    }
    if slots.is_empty() && style_slots.is_empty() {
        return false;
    }

    commit(|data| {
        data.slots = slots;
        data.style_slots = style_slots;
        ((), true)
    });
    true
}

pub fn display_name(item: &SlotItem) -> String {
    if let Some(name) = &item.display_name {
        if !name.is_empty() {
            return name.clone();
        }
    }
    let normalized = item.path.trim_end_matches(['\\', '/']);
    normalized
        .rsplit(['\\', '/'])
        .next()
        .filter(|segment| !segment.is_empty())
        .unwrap_or(&item.path)
        .to_string()
}

pub fn is_missing(path: &str) -> bool {
    let path = path.trim().trim_matches('"');
    !path.is_empty() && !std::path::Path::new(path).exists()
}
