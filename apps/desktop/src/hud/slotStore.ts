/** 格子数据。当前存在 localStorage，后续迁移到 settings.json 时只换这一层。 */

export interface SlotItem {
  path: string;
  displayName?: string;
}

export type SlotMap = Record<string, SlotItem>;

const STORAGE_KEY = "craftsharp.slots.v1";

export function hotbarSlotId(index: number): string {
  return `hotbar_${index}`;
}

/** 全局格子索引 2-10 对应 hotbar_0-hotbar_8 */
export function hotbarIndexFromGlobal(slotIndex: number): number {
  return slotIndex - 2;
}

let slots: SlotMap = loadSlots();
const listeners = new Set<() => void>();

function loadSlots(): SlotMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // 存储不可用时保持内存态，HUD 仍可运行
  }
}

function notify() {
  persist();
  for (const listener of listeners) listener();
}

export function getSlot(slotId: string): SlotItem | undefined {
  return slots[slotId];
}

export function getHotbarItem(index: number): SlotItem | undefined {
  return slots[hotbarSlotId(index)];
}

export function setSlot(slotId: string, item: SlotItem) {
  slots = { ...slots, [slotId]: item };
  notify();
}

export function clearSlot(slotId: string) {
  if (!slots[slotId]) return;
  const next = { ...slots };
  delete next[slotId];
  slots = next;
  notify();
}

/** 所有使用该路径的格子一起清空，对应原 SlotFileValidator.ClearAllSlotsByPath */
export function clearSlotsByPath(path: string) {
  const next: SlotMap = {};
  let changed = false;
  for (const [key, item] of Object.entries(slots)) {
    if (item.path === path) {
      changed = true;
      continue;
    }
    next[key] = item;
  }
  if (!changed) return;
  slots = next;
  notify();
}

/** 文件重命名后同步所有使用该路径的格子 */
export function replaceSlotsPath(from: string, to: string) {
  let changed = false;
  const next: SlotMap = {};
  for (const [key, item] of Object.entries(slots)) {
    if (item.path === from) {
      changed = true;
      next[key] = { ...item, path: to };
    } else {
      next[key] = item;
    }
  }
  if (!changed) return;
  slots = next;
  notify();
}

export function swapSlots(fromId: string, toId: string) {
  const from = slots[fromId];
  const to = slots[toId];
  const next = { ...slots };

  if (to) next[fromId] = to;
  else delete next[fromId];

  if (from) next[toId] = from;
  else delete next[toId];

  slots = next;
  notify();
}

export function subscribeSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 多窗口共享同一份 localStorage，另一个窗口写入后同步刷新
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  slots = loadSlots();
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
