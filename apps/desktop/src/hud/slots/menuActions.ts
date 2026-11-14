/** 格子右键菜单项与动作，快捷栏与物品栏共用 */

import { invoke } from "@tauri-apps/api/core";
import {
  copyItemPath,
  copySlot,
  cutSlot,
  deleteSlotContent,
  getClipboard,
  openItem,
  pasteInto,
  renameItem,
  revealItem,
  runItemAsAdmin,
  type SlotScope
} from "@/hud/slots/actions";
import type { MenuItemSpec } from "@/hud/slots/menu";
import type { SlotItem } from "@/hud/slots/store";

const EXECUTABLE_EXTENSIONS = [".exe", ".bat", ".cmd", ".msi", ".ps1", ".vbs"];

function isExecutable(path: string): boolean {
  const lower = path.toLowerCase();
  return EXECUTABLE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export async function buildSlotMenuItems(item: SlotItem | undefined, scope: SlotScope): Promise<MenuItemSpec[]> {
  const clipboardPaths = await invoke<string[]>("read_clipboard_paths").catch(() => []);
  const hasClipboard = getClipboard() !== null || clipboardPaths.length > 0;

  if (!item) {
    return [{ id: "paste", label: "粘贴", disabled: !hasClipboard }];
  }

  const items: MenuItemSpec[] = [
    { id: "open", label: "打开" },
    { id: "reveal", label: "打开文件所在位置" }
  ];

  if (isExecutable(item.path)) {
    items.push({ id: "admin", label: "以管理员身份运行" });
  }

  items.push(
    { id: "separator-1", label: "", separator: true },
    { id: "copy-path", label: "复制文件地址" },
    { id: "cut", label: "剪切" },
    { id: "copy", label: "复制" },
    { id: "paste", label: "粘贴", disabled: !hasClipboard },
    { id: "separator-2", label: "", separator: true },
    { id: "delete", label: "删除" },
    { id: "rename", label: "重命名" }
  );

  return items;
}

export async function runSlotMenuAction(
  action: string,
  slotId: string,
  item: SlotItem | undefined,
  scope: SlotScope
): Promise<void> {
  switch (action) {
    case "open":
      if (item) await openItem(slotId, item, scope);
      break;
    case "reveal":
      if (item) await revealItem(item, scope);
      break;
    case "admin":
      if (item) await runItemAsAdmin(item, scope);
      break;
    case "copy-path":
      if (item) await copyItemPath(item);
      break;
    case "cut":
      if (item) await cutSlot(slotId, item);
      break;
    case "copy":
      if (item) await copySlot(slotId, item);
      break;
    case "paste":
      await pasteInto(slotId, scope);
      break;
    case "delete":
      deleteSlotContent(slotId, scope);
      break;
    case "rename":
      if (item) await renameItem(item, scope);
      break;
    default:
      break;
  }
}
