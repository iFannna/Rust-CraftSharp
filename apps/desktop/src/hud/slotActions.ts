import { invoke } from "@tauri-apps/api/core";
import {
  clearSlot,
  clearSlotsByPath,
  displayNameOf,
  replaceSlotsPath,
  setSlot,
  type SlotItem
} from "./slotStore";

interface ClipboardState {
  slotId: string;
  item: SlotItem;
  cut: boolean;
}

let clipboard: ClipboardState | null = null;
const clipboardListeners = new Set<() => void>();

function notifyClipboard() {
  for (const listener of clipboardListeners) listener();
}

export function subscribeClipboard(listener: () => void): () => void {
  clipboardListeners.add(listener);
  return () => clipboardListeners.delete(listener);
}

export function getClipboard(): ClipboardState | null {
  return clipboard;
}

function setClipboard(next: ClipboardState | null) {
  clipboard = next;
  notifyClipboard();
}

export async function copySlot(slotId: string, item: SlotItem): Promise<void> {
  setClipboard({ slotId, item, cut: false });
  await invoke("copy_to_clipboard", { text: item.path }).catch(() => undefined);
}

export async function cutSlot(slotId: string, item: SlotItem): Promise<void> {
  setClipboard({ slotId, item, cut: true });
  await invoke("copy_to_clipboard", { text: item.path }).catch(() => undefined);
}

/** 粘贴到目标格子：优先内部剪贴板，其次 Windows 剪贴板中的文件 */
export async function pasteInto(slotId: string): Promise<boolean> {
  if (clipboard) {
    const { slotId: sourceSlotId, item, cut } = clipboard;
    setSlot(slotId, { path: item.path, displayName: item.displayName });

    if (cut) {
      if (sourceSlotId !== slotId) clearSlot(sourceSlotId);
      setClipboard(null);
    }
    return true;
  }

  const paths = await invoke<string[]>("read_clipboard_paths").catch(() => []);
  const path = paths.find((candidate) => candidate.trim().length > 0);
  if (!path) return false;

  setSlot(slotId, { path });
  return true;
}

export async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path }).catch(() => false);
}

/** 文件丢失确认：返回是否清除所有使用该路径的格子 */
export function confirmMissingFile(path: string): boolean {
  const confirmed = window.confirm(`文件不存在：\n${path}\n\n是否清除所有使用这个路径的格子？`);
  if (confirmed) clearSlotsByPath(path);
  return confirmed;
}

export async function openItem(slotId: string, item: SlotItem): Promise<void> {
  if (!(await pathExists(item.path))) {
    confirmMissingFile(item.path);
    return;
  }
  await invoke("open_path", { path: item.path }).catch((error) => console.warn("打开失败", error));
}

export async function revealItem(item: SlotItem): Promise<void> {
  if (!(await pathExists(item.path))) {
    confirmMissingFile(item.path);
    return;
  }
  await invoke("reveal_path", { path: item.path }).catch((error) => console.warn("定位失败", error));
}

export async function runItemAsAdmin(item: SlotItem): Promise<void> {
  if (!(await pathExists(item.path))) {
    confirmMissingFile(item.path);
    return;
  }
  await invoke("run_path_as_admin", { path: item.path }).catch((error) => console.warn("管理员运行失败", error));
}

export async function copyItemPath(item: SlotItem): Promise<void> {
  await invoke("copy_to_clipboard", { text: item.path }).catch(() => undefined);
}

export function deleteSlotContent(slotId: string): void {
  clearSlot(slotId);
}

export async function renameItem(item: SlotItem): Promise<boolean> {
  const name = displayNameOf(item);
  const dotIndex = name.lastIndexOf(".");
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  const separatorIndex = Math.max(item.path.lastIndexOf("\\"), item.path.lastIndexOf("/"));
  const directory = item.path.slice(0, separatorIndex + 1);

  const input = window.prompt("重命名", stem);
  if (input === null) return false;

  const nextStem = input.trim();
  if (!nextStem || nextStem === stem) return false;

  const nextPath = `${directory}${nextStem}${extension}`;
  if (await pathExists(nextPath)) {
    window.alert(`文件 "${nextStem}${extension}" 已存在，请使用其他名称。`);
    return false;
  }

  try {
    await invoke("rename_path", { from: item.path, to: nextPath });
  } catch (error) {
    window.alert(`重命名失败：${String(error)}`);
    return false;
  }

  replaceSlotsPath(item.path, nextPath);
  return true;
}
