/** 格子数据：Rust 是唯一写入者，这里只是本窗口的只读镜像。 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface SlotItem {
  path: string;
  displayName?: string;
}

export type SlotMap = Record<string, SlotItem>;
export type StyleSlotMap = Record<string, SlotMap>;

const STORAGE_KEY = "craftsharp.slots.v1";
const STYLE_STORAGE_KEY = "craftsharp.styleSlots.v1";
const HOTBAR_STYLE = "inventory.png";
const inTauri = typeof window !== "undefined"
  && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

interface Snapshot {
  rev: number;
  slots: unknown;
  styleSlots?: unknown;
}

export function hotbarSlotId(index: number): string {
  return `hotbar_${index}`;
}

/** 全局格子索引 0 左副手、1 右副手、2-10 主快捷栏 */
export function slotIdForGlobal(globalIndex: number): string {
  if (globalIndex === 0) return "hotbar_left_offhand";
  if (globalIndex === 1) return "hotbar_right_offhand";
  return hotbarSlotId(globalIndex - 2);
}

export function getSlotItem(globalIndex: number): SlotItem | undefined {
  return slots[slotIdForGlobal(globalIndex)];
}

/** 全局格子索引 2-10 对应 hotbar_0-hotbar_8 */
export function hotbarIndexFromGlobal(slotIndex: number): number {
  return slotIndex - 2;
}

let slots: SlotMap = loadSlots();
let styleSlots: StyleSlotMap = loadStyleSlots();
let lastRev = -1;
const listeners = new Set<() => void>();

function normalizeSlotMap(raw: unknown): SlotMap {
  const result: SlotMap = {};
  if (!raw || typeof raw !== "object") return result;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const item = value as SlotItem;
    if (typeof item.path !== "string" || item.path.length === 0) continue;
    result[key] = {
      path: item.path,
      displayName: typeof item.displayName === "string" ? item.displayName : undefined
    };
  }
  return result;
}

function normalizeStyleSlots(raw: unknown): StyleSlotMap {
  const result: StyleSlotMap = {};
  if (!raw || typeof raw !== "object") return result;
  for (const [style, value] of Object.entries(raw as Record<string, unknown>)) {
    result[style] = normalizeSlotMap(value);
  }
  return result;
}

function parseSlotMap(raw: string | null): SlotMap {
  try {
    return normalizeSlotMap(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

function loadSlots(): SlotMap {
  return parseSlotMap(localStorage.getItem(STORAGE_KEY));
}

function loadStyleSlots(): StyleSlotMap {
  try {
    return normalizeStyleSlots(localStorage.getItem(STYLE_STORAGE_KEY));
  } catch {
    return {};
  }
}

/** 共享数据读 flat 表，独立数据读当前样式的表，对应原 SlotDataService 的两套存储 */
export function slotMapFor(style: string, shared: boolean): SlotMap {
  return shared ? slots : styleSlots[style] ?? {};
}

function persistPreview() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
    localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(styleSlots));
  } catch {
    // 浏览器预览不可用时保持内存态
  }
}

function notify() {
  if (!inTauri) persistPreview();
  for (const listener of listeners) listener();
}

function applySnapshot(snapshot: Snapshot, force = false) {
  const rev = Number(snapshot.rev) || 0;
  if (!force && rev <= lastRev) return;
  lastRev = rev;
  slots = normalizeSlotMap(snapshot.slots);
  styleSlots = normalizeStyleSlots(snapshot.styleSlots);
  for (const listener of listeners) listener();
}

async function syncFromRust(force = false) {
  if (!inTauri) return;
  try {
    const snapshot = await invoke<Snapshot>("slots_snapshot");
    applySnapshot(snapshot, force);
  } catch {
    // 原生侧不可用时保留当前内存镜像
  }
}

function send(command: string, args: Record<string, unknown>) {
  if (!inTauri) return;
  void invoke(command, args).catch(() => {
    void syncFromRust(true);
  });
}

async function bootstrap() {
  if (!inTauri) return;

  void listen<Snapshot>("slots-changed", ({ payload }) => applySnapshot(payload)).catch(() => undefined);

  // 旧版 localStorage 只在首次启动、没有 slots.json 时导入一次
  try {
    const flat = localStorage.getItem(STORAGE_KEY);
    const styles = localStorage.getItem(STYLE_STORAGE_KEY);
    if (flat || styles) {
      await invoke("slots_import_legacy", {
        slotsJson: flat ? JSON.parse(flat) : null,
        stylesJson: styles ? JSON.parse(styles) : null
      });
    }
    await syncFromRust();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STYLE_STORAGE_KEY);
  } catch {
    await syncFromRust();
  }
}

void bootstrap();

function updateMap(style: string, shared: boolean, mutation: (map: SlotMap) => SlotMap | null) {
  const current = slotMapFor(style, shared);
  const next = mutation(current);
  if (!next) return;

  if (shared) {
    slots = next;
  } else {
    styleSlots = { ...styleSlots, [style]: next };
  }

  notify();
}

export function getSlot(slotId: string): SlotItem | undefined {
  return slots[slotId];
}

export function setSlot(slotId: string, item: SlotItem) {
  updateMap(HOTBAR_STYLE, true, (map) => ({ ...map, [slotId]: item }));
  send("slots_set", { slotId, item, style: HOTBAR_STYLE, shared: true });
}

export function clearSlot(slotId: string) {
  updateMap(HOTBAR_STYLE, true, (map) => {
    if (!map[slotId]) return null;
    const next = { ...map };
    delete next[slotId];
    return next;
  });
  send("slots_clear", { slotId, style: HOTBAR_STYLE, shared: true });
}

/** 所有使用该路径的格子一起清空，对应原 SlotFileValidator.ClearAllSlotsByPath */
export function clearSlotsByPath(path: string) {
  updateMap(HOTBAR_STYLE, true, (map) => {
    const next: SlotMap = {};
    let changed = false;
    for (const [key, item] of Object.entries(map)) {
      if (item.path === path) {
        changed = true;
        continue;
      }
      next[key] = item;
    }
    return changed ? next : null;
  });
  send("slots_clear_by_path", { path, style: HOTBAR_STYLE, shared: true });
}

/** 文件重命名后同步所有使用该路径的格子 */
export function replaceSlotsPath(from: string, to: string) {
  updateMap(HOTBAR_STYLE, true, (map) => {
    let changed = false;
    const next: SlotMap = {};
    for (const [key, item] of Object.entries(map)) {
      if (item.path === from) {
        changed = true;
        next[key] = { ...item, path: to };
      } else {
        next[key] = item;
      }
    }
    return changed ? next : null;
  });
  send("slots_replace_path", { from, to, style: HOTBAR_STYLE, shared: true });
}

export function swapSlots(fromId: string, toId: string) {
  updateMap(HOTBAR_STYLE, true, (map) => swapInMap(map, fromId, toId));
  send("slots_swap", { from: fromId, to: toId, style: HOTBAR_STYLE, shared: true });
}

/** 按样式与共享模式取格子，对应原 SlotDataService.GetSlot(slotId, style, shared) */
export function getSlotFor(slotId: string, style: string, shared: boolean): SlotItem | undefined {
  return slotMapFor(style, shared)[slotId];
}

export function setSlotFor(slotId: string, item: SlotItem, style: string, shared: boolean) {
  updateMap(style, shared, (map) => ({ ...map, [slotId]: item }));
  send("slots_set", { slotId, item, style, shared });
}

export function clearSlotFor(slotId: string, style: string, shared: boolean) {
  updateMap(style, shared, (map) => {
    if (!map[slotId]) return null;
    const next = { ...map };
    delete next[slotId];
    return next;
  });
  send("slots_clear", { slotId, style, shared });
}

export function clearSlotsByPathFor(path: string, style: string, shared: boolean) {
  updateMap(style, shared, (map) => {
    const next: SlotMap = {};
    let changed = false;
    for (const [key, item] of Object.entries(map)) {
      if (item.path === path) {
        changed = true;
        continue;
      }
      next[key] = item;
    }
    return changed ? next : null;
  });
  send("slots_clear_by_path", { path, style, shared });
}

export function replaceSlotsPathFor(from: string, to: string, style: string, shared: boolean) {
  updateMap(style, shared, (map) => {
    let changed = false;
    const next: SlotMap = {};
    for (const [key, item] of Object.entries(map)) {
      if (item.path === from) {
        changed = true;
        next[key] = { ...item, path: to };
      } else {
        next[key] = item;
      }
    }
    return changed ? next : null;
  });
  send("slots_replace_path", { from, to, style, shared });
}

export function swapSlotsFor(fromId: string, toId: string, style: string, shared: boolean) {
  updateMap(style, shared, (map) => swapInMap(map, fromId, toId));
  send("slots_swap", { from: fromId, to: toId, style, shared });
}

function swapInMap(map: SlotMap, fromId: string, toId: string): SlotMap {
  const from = map[fromId];
  const to = map[toId];
  const next = { ...map };

  if (to) next[fromId] = to;
  else delete next[fromId];

  if (from) next[toId] = from;
  else delete next[toId];

  return next;
}

export function subscribeSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 浏览器预览没有 Rust 侧，窗口之间仍靠 localStorage 同步
if (!inTauri) {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      slots = loadSlots();
    } else if (event.key === STYLE_STORAGE_KEY) {
      styleSlots = loadStyleSlots();
    } else {
      return;
    }

    for (const listener of listeners) listener();
  });
}

export function displayNameOf(item: SlotItem): string {
  if (item.displayName) return item.displayName;
  const normalized = item.path.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] || item.path;
}

/** 文件名自动配色，与原实现同一组预设色 */
const PRESET_COLORS = [
  "#FCFCFC",
  "#A8A8A8",
  "#FCFC54",
  "#5454FC",
  "#FC54FC",
  "#A800A8",
  "#FC5454",
  "#54FCFC",
  "#00A800"
];

export function autoFileNameColor(fileName: string): string {
  if (!fileName) return PRESET_COLORS[0];

  // .NET 的字符串哈希每个进程随机，这里用稳定哈希保证同名同色
  let hash = 0x811c9dc5;
  for (let index = 0; index < fileName.length; index += 1) {
    hash ^= fileName.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return PRESET_COLORS[hash % PRESET_COLORS.length];
}
