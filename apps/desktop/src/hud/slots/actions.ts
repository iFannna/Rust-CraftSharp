import { invoke } from "@tauri-apps/api/core";
import { getConfig } from "@/config/appConfig";
import { openDialogWindow } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { isTauri } from "@/lib/runtime";
import { tOf } from "@/i18n";
import {
  clearSlotFor,
  clearSlotsByPathFor,
  displayNameOf,
  moveSlotFor,
  replaceSlotsPathFor,
  setSlotFor,
  type SlotItem
} from "@/hud/slots/store";

/** 格子数据作用域：共享模式忽略 style，独立模式按样式隔离 */
export interface SlotScope {
  style: string;
  shared: boolean;
}

export const SHARED_SCOPE: SlotScope = { style: "inventory.png", shared: true };

/** 两个作用域是否读同一份格子数据：共享模式共用一张表，独立模式按样式隔离 */
export function sameSlotScope(a: SlotScope, b: SlotScope): boolean {
  return a.shared === b.shared && (a.shared || a.style === b.style);
}

const inTauri = isTauri();

async function showConfirm(text: string): Promise<boolean> {
  if (!inTauri) return window.confirm(text);
  const t = tOf(getConfig().system.language);
  const result = await openDialogWindow<boolean>({
    label: WINDOW_LABEL.confirm,
    title: t("dialog.confirmTitle"),
    page: "confirm",
    params: { kind: "confirm", text },
    width: 460,
    height: 260
  });
  return result === true;
}

async function showAlert(text: string): Promise<void> {
  if (!inTauri) {
    window.alert(text);
    return;
  }
  const t = tOf(getConfig().system.language);
  await openDialogWindow<boolean>({
    label: WINDOW_LABEL.confirm,
    title: t("dialog.alertTitle"),
    page: "confirm",
    params: { kind: "alert", text },
    width: 460,
    height: 260
  });
}

/** 重命名对话框独立成窗口，避免隐藏窗口里的 prompt 不可见 */
async function askRename(initial: string): Promise<string | null> {
  const t = tOf(getConfig().system.language);
  if (!inTauri) return window.prompt(t("rename.title"), initial);
  return openDialogWindow<string>({
    label: WINDOW_LABEL.rename,
    title: t("rename.title"),
    page: "rename",
    params: { name: initial },
    width: 380,
    height: 220
  });
}

interface ClipboardState {
  slotId: string;
  item: SlotItem;
  cut: boolean;
  scope: SlotScope;
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

export async function copySlot(slotId: string, item: SlotItem, scope: SlotScope = SHARED_SCOPE): Promise<void> {
  setClipboard({ slotId, item, cut: false, scope });
  await invoke("copy_to_clipboard", { text: item.path }).catch(() => undefined);
}

export async function cutSlot(slotId: string, item: SlotItem, scope: SlotScope = SHARED_SCOPE): Promise<void> {
  setClipboard({ slotId, item, cut: true, scope });
  await invoke("copy_to_clipboard", { text: item.path }).catch(() => undefined);
}

/** 粘贴到目标格子：优先内部剪贴板，其次 Windows 剪贴板中的文件 */
export async function pasteInto(slotId: string, scope: SlotScope = SHARED_SCOPE): Promise<boolean> {
  if (clipboard) {
    const { slotId: sourceSlotId, item, cut, scope: sourceScope } = clipboard;
    if (cut) {
      // 剪切粘贴是一次搬移：源格清空与目标格写入一起提交，再清剪贴板，避免旧快照回显闪出源格图标
      if (sourceSlotId !== slotId || !sameSlotScope(sourceScope, scope)) {
        moveSlotFor(sourceSlotId, slotId, item, sourceScope, scope);
      }
      setClipboard(null);
    } else {
      setSlotFor(slotId, { path: item.path, displayName: item.displayName }, scope.style, scope.shared);
    }
    return true;
  }

  const paths = await invoke<string[]>("read_clipboard_paths").catch(() => []);
  const path = paths.find((candidate) => candidate.trim().length > 0);
  if (!path) return false;

  setSlotFor(slotId, { path }, scope.style, scope.shared);
  return true;
}

export async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path }).catch(() => false);
}

/** 文件丢失确认：返回是否清除所有使用该路径的格子 */
export async function confirmMissingFile(path: string, scope: SlotScope = SHARED_SCOPE): Promise<boolean> {
  const t = tOf(getConfig().system.language);
  const confirmed = await showConfirm(t("files.missing", { path }));
  if (confirmed) clearSlotsByPathFor(path, scope.style, scope.shared);
  return confirmed;
}

export async function openItem(slotId: string, item: SlotItem, scope: SlotScope = SHARED_SCOPE): Promise<void> {
  if (!(await pathExists(item.path))) {
    await confirmMissingFile(item.path, scope);
    return;
  }
  await invoke("open_path", { path: item.path }).catch((error) => console.warn("打开失败", error));
}

export async function revealItem(item: SlotItem, scope: SlotScope = SHARED_SCOPE): Promise<void> {
  if (!(await pathExists(item.path))) {
    await confirmMissingFile(item.path, scope);
    return;
  }
  await invoke("reveal_path", { path: item.path }).catch((error) => console.warn("定位失败", error));
}

export async function runItemAsAdmin(item: SlotItem, scope: SlotScope = SHARED_SCOPE): Promise<void> {
  if (!(await pathExists(item.path))) {
    await confirmMissingFile(item.path, scope);
    return;
  }
  await invoke("run_path_as_admin", { path: item.path }).catch((error) => console.warn("管理员运行失败", error));
}

export async function copyItemPath(item: SlotItem): Promise<void> {
  await invoke("copy_to_clipboard", { text: item.path }).catch(() => undefined);
}

export function deleteSlotContent(slotId: string, scope: SlotScope = SHARED_SCOPE): void {
  clearSlotFor(slotId, scope.style, scope.shared);
}

export async function renameItem(item: SlotItem, scope: SlotScope = SHARED_SCOPE): Promise<boolean> {
  const name = displayNameOf(item);
  const dotIndex = name.lastIndexOf(".");
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  const separatorIndex = Math.max(item.path.lastIndexOf("\\"), item.path.lastIndexOf("/"));
  const directory = item.path.slice(0, separatorIndex + 1);

  const input = await askRename(stem);
  if (input === null) return false;

  const nextStem = input.trim();
  if (!nextStem || nextStem === stem) return false;

  const nextPath = `${directory}${nextStem}${extension}`;
  const t = tOf(getConfig().system.language);
  if (await pathExists(nextPath)) {
    await showAlert(t("files.exists", { name: `${nextStem}${extension}` }));
    return false;
  }

  try {
    await invoke("rename_path", { from: item.path, to: nextPath });
  } catch (error) {
    await showAlert(t("files.renameFailed", { reason: String(error) }));
    return false;
  }

  replaceSlotsPathFor(item.path, nextPath, scope.style, scope.shared);
  return true;
}
