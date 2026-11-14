/** 格子数据。当前存在 localStorage，后续迁移到 settings.json 时只换这一层。 */

export interface SlotItem {
  path: string;
  displayName?: string;
}

export type SlotMap = Record<string, SlotItem>;
export type StyleSlotMap = Record<string, SlotMap>;

const STORAGE_KEY = "craftsharp.slots.v1";
const STYLE_STORAGE_KEY = "craftsharp.styleSlots.v1";

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
const listeners = new Set<() => void>();

function parseSlotMap(raw: string | null): SlotMap {
  try {
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const result: SlotMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const item = value as SlotItem;
      if (typeof item.path !== "string" || item.path.length === 0) continue;
      result[key] = { path: item.path, displayName: item.displayName };
    }
    return result;
  } catch {
    return {};
  }
}

function loadSlots(): SlotMap {
  return parseSlotMap(localStorage.getItem(STORAGE_KEY));
}

function loadStyleSlots(): StyleSlotMap {
  try {
    const raw = localStorage.getItem(STYLE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const result: StyleSlotMap = {};
    for (const [style, value] of Object.entries(parsed as Record<string, unknown>)) {
      result[style] = parseSlotMap(JSON.stringify(value));
    }
    return result;
  } catch {
    return {};
  }
}

/** 共享数据读 flat 表，独立数据读当前样式的表，对应原 SlotDataService 的两套存储 */
export function slotMapFor(style: string, shared: boolean): SlotMap {
  return shared ? slots : styleSlots[style] ?? {};
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
    localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(styleSlots));
  } catch {
    // 存储不可用时保持内存态，HUD 仍可运行
  }
}

function notify() {
  persist();
  for (const listener of listeners) listener();
}

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
  updateMap("inventory.png", true, (map) => ({ ...map, [slotId]: item }));
}

export function clearSlot(slotId: string) {
  updateMap("inventory.png", true, (map) => {
    if (!map[slotId]) return null;
    const next = { ...map };
    delete next[slotId];
    return next;
  });
}

/** 所有使用该路径的格子一起清空，对应原 SlotFileValidator.ClearAllSlotsByPath */
export function clearSlotsByPath(path: string) {
  updateMap("inventory.png", true, (map) => {
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
}

/** 文件重命名后同步所有使用该路径的格子 */
export function replaceSlotsPath(from: string, to: string) {
  updateMap("inventory.png", true, (map) => {
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
}

export function swapSlots(fromId: string, toId: string) {
  updateMap("inventory.png", true, (map) => swapInMap(map, fromId, toId));
}

/** 按样式与共享模式取格子，对应原 SlotDataService.GetSlot(slotId, style, shared) */
export function getSlotFor(slotId: string, style: string, shared: boolean): SlotItem | undefined {
  return slotMapFor(style, shared)[slotId];
}

export function setSlotFor(slotId: string, item: SlotItem, style: string, shared: boolean) {
  updateMap(style, shared, (map) => ({ ...map, [slotId]: item }));
}

export function clearSlotFor(slotId: string, style: string, shared: boolean) {
  updateMap(style, shared, (map) => {
    if (!map[slotId]) return null;
    const next = { ...map };
    delete next[slotId];
    return next;
  });
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
}

export function swapSlotsFor(fromId: string, toId: string, style: string, shared: boolean) {
  updateMap(style, shared, (map) => swapInMap(map, fromId, toId));
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

// 多窗口共享同一份 localStorage，另一个窗口写入后同步刷新
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
