/** 托盘动作与菜单条目的文案映射，设置页和运行时菜单共用 */

import type { TrayAction, TrayMenuItemId } from "@/config/appConfig";
import type { MessageKey, TFunction } from "@/i18n";

const ITEM_KEYS: Record<TrayMenuItemId, MessageKey> = {
  settings: "tray.itemSettings",
  statusBar: "tray.itemStatusBar",
  inventory: "tray.itemInventory",
  crosshair: "tray.itemCrosshair",
  desktopIcons: "tray.itemDesktopIcons"
};

export function trayItemLabel(t: TFunction, id: TrayMenuItemId): string {
  return t(ITEM_KEYS[id]);
}

export function trayActionLabel(t: TFunction, action: TrayAction): string {
  if (action === "none") return t("tray.actionNone");
  if (action === "menu") return t("tray.actionMenu");
  return t("tray.toggleItem", { name: trayItemLabel(t, action) });
}

/** 菜单条目按当前显隐状态生成「显示… / 隐藏…」 */
export function trayMenuEntryLabel(t: TFunction, id: TrayMenuItemId, visible: boolean): string {
  return t(visible ? "tray.hideItem" : "tray.showItem", { name: trayItemLabel(t, id) });
}
