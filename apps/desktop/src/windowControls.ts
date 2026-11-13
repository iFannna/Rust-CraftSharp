/** 窗口显隐统一入口，主界面、设置面板、全局热键共用 */

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getConfig, updateConfig } from "./config/appConfig";

export type WindowLabel = "main" | "hud" | "inventory" | "overlay" | "settings" | "crosshair";

async function windowOf(label: WindowLabel): Promise<WebviewWindow | null> {
  return WebviewWindow.getByLabel(label);
}

async function setVisible(label: WindowLabel, visible: boolean, focus = false) {
  const target = await windowOf(label);
  if (!target) return;

  if (visible) {
    await target.show();
    if (focus) await target.setFocus();
  } else {
    await target.hide();
  }
}

let statusBarHiddenByInventory = false;

export async function setStatusBarVisible(visible: boolean, persist = true) {
  await setVisible("hud", visible);
  if (persist) updateConfig({ statusBar: { visible } });
}

export async function toggleStatusBar() {
  await setStatusBarVisible(!getConfig().statusBar.visible);
}

export async function setInventoryVisible(visible: boolean, persist = true) {
  const config = getConfig().inventory;
  const overlay = await windowOf("overlay");

  if (visible) {
    if (config.grayOverlay && overlay) {
      await overlay.show();
    }

    await setVisible("inventory", true, true);

    if (config.hideStatusBar && getConfig().statusBar.visible) {
      statusBarHiddenByInventory = true;
      await setVisible("hud", false);
    }
  } else {
    await setVisible("inventory", false);
    if (overlay) await overlay.hide();

    if (statusBarHiddenByInventory) {
      statusBarHiddenByInventory = false;
      await setVisible("hud", getConfig().statusBar.visible);
    }
  }

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
  const visible = await target.isVisible();
  await setVisible("settings", !visible, !visible);
}

export async function setCrosshairVisible(visible: boolean) {
  await setVisible("crosshair", visible);
  updateConfig({ hudElements: { crosshairVisible: visible } });
}

export async function toggleCrosshair() {
  await setCrosshairVisible(!getConfig().hudElements.crosshairVisible);
}

/** 启动时按配置恢复各窗口显隐 */
export async function applyConfiguredVisibility() {
  const config = getConfig();
  await setVisible("hud", config.statusBar.visible);
  // 准星窗口自己铺满屏幕后按配置显示，这里不抢先 show
  if (config.inventory.visible) {
    await setInventoryVisible(true, false);
  }
}
