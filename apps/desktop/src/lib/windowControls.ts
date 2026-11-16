/** 窗口显隐统一入口，主界面、设置面板、全局热键共用 */

import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getConfig, updateConfig } from "@/config/appConfig";
import { WINDOW_LABEL } from "@/lib/windowLabels";

export type WindowLabel = "main" | "settings" | "entity-preview";

async function windowOf(label: WindowLabel): Promise<WebviewWindow | null> {
  return WebviewWindow.getByLabel(label);
}

async function setVisible(label: WindowLabel, visible: boolean, focus = false) {
  const target = await windowOf(label);
  if (!target) return;

  if (!visible) {
    if (label === WINDOW_LABEL.settings) {
      // 设置面板收起时，从它打开的展示窗口一起收起
      const picker = await WebviewWindow.getByLabel(WINDOW_LABEL.iconPicker);
      await picker?.close().catch(() => undefined);
    }
    await target.hide().catch(() => undefined);
    return;
  }

  await target.setSkipTaskbar(false).catch(() => undefined);
  await target.show().catch(() => undefined);
  if (await target.isMinimized().catch(() => false)) {
    await target.unminimize().catch(() => undefined);
  }
  if (focus) await target.setFocus().catch(() => undefined);
}

/** 状态栏由 Rust 原生窗口绘制，显隐走独立命令 */
async function setHudVisible(visible: boolean) {
  await invoke("hud_visible", { visible }).catch(() => undefined);
}

export async function setStatusBarVisible(visible: boolean, persist = true) {
  await setHudVisible(visible);
  if (persist) updateConfig({ statusBar: { visible } });
}

export async function toggleStatusBar() {
  await setStatusBarVisible(!getConfig().statusBar.visible);
}

export async function setInventoryVisible(visible: boolean, persist = true) {
  // 原生物品栏自己管理蒙版与状态栏隐藏
  await invoke("inventory_visible", { visible }).catch(() => undefined);
  if (persist) updateConfig({ inventory: { visible } });
}

export async function toggleInventory() {
  await setInventoryVisible(!getConfig().inventory.visible);
}

export async function setSettingsVisible(visible: boolean) {
  await setVisible("settings", visible, visible);
}

export async function toggleSettings() {
  const target = await windowOf("settings");
  if (!target) return;
  const [visible, minimized] = await Promise.all([target.isVisible(), target.isMinimized()]);
  if (minimized) {
    await setVisible("settings", true, true);
    return;
  }
  await setVisible("settings", !visible, !visible);
}

export async function setCrosshairVisible(visible: boolean) {
  updateConfig({ hudElements: { crosshairVisible: visible } });
}

export async function toggleEntityPreview() {
  const target = await windowOf("entity-preview");
  if (!target) {
    // 预览窗口按需创建，启动时不加载 three
    new WebviewWindow(WINDOW_LABEL.entityPreview, {
      url: "pages/entity-preview.html",
      title: "CraftSharp 3D 预览",
      width: 1000,
      height: 680,
      minWidth: 760,
      minHeight: 480,
      center: true,
      decorations: false,
      shadow: true,
      resizable: true,
      focus: true
    });
    return;
  }
  const [visible, minimized] = await Promise.all([target.isVisible(), target.isMinimized()]);
  if (minimized) {
    await setVisible("entity-preview", true, true);
    return;
  }
  await setVisible("entity-preview", !visible, !visible);
}

export async function toggleCrosshair() {
  await setCrosshairVisible(!getConfig().hudElements.crosshairVisible);
}

export type WindowAction = "settings" | "statusBar" | "inventory" | "crosshair" | "preview3d";

/** 托盘与热键共用的动作分发 */
export async function applyWindowAction(action: WindowAction) {
  switch (action) {
    case "settings":
      await toggleSettings();
      break;
    case "statusBar":
      await toggleStatusBar();
      break;
    case "inventory":
      await toggleInventory();
      break;
    case "crosshair":
      await toggleCrosshair();
      break;
    case "preview3d":
      await toggleEntityPreview();
      break;
    default:
      break;
  }
}

/** 启动时按配置恢复各窗口显隐 */
export async function applyConfiguredVisibility() {
  const config = getConfig();
  await setHudVisible(config.statusBar.visible);
  if (config.inventory.visible) {
    await setInventoryVisible(true, false);
  }
}
