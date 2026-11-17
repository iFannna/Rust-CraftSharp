/** 托盘手势：按配置分发鼠标动作，右键菜单在光标处按实时状态生成 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getConfig, type TrayAction, type TrayMenuItemId } from "@/config/appConfig";
import { showTrayMenuAt, type MenuItemSpec } from "@/hud/slots/menu";
import { tOf } from "@/i18n";
import { isTauri } from "@/lib/runtime";
import { trayMenuEntryLabel } from "@/lib/trayLabels";
import {
  applyWindowAction,
  setCrosshairVisible,
  setInventoryVisible,
  setSettingsVisible,
  setStatusBarVisible
} from "@/lib/windowControls";
import { WINDOW_LABEL } from "@/lib/windowLabels";

type TrayButton = "left" | "right" | "middle";

interface TrayPointer {
  button: TrayButton;
  x: number;
  y: number;
}

interface TrayState {
  statusBar: boolean;
  inventory: boolean;
  desktopIcons: boolean;
  doubleClickMs: number;
}

const FALLBACK_DOUBLE_CLICK_MS = 500;
const STATE_FALLBACK: TrayState = {
  statusBar: false,
  inventory: false,
  desktopIcons: true,
  doubleClickMs: FALLBACK_DOUBLE_CLICK_MS
};

let doubleClickMs = FALLBACK_DOUBLE_CLICK_MS;
let lastLeftUp = 0;
let pendingSingle: number | null = null;
let initialized = false;

async function readState(): Promise<TrayState> {
  return invoke<TrayState>("tray_state").catch(() => STATE_FALLBACK);
}

async function isSettingsVisible(): Promise<boolean> {
  const window = await WebviewWindow.getByLabel(WINDOW_LABEL.settings).catch(() => null);
  if (!window) return false;
  return window.isVisible().catch(() => false);
}

async function openContextMenu(position: TrayPointer): Promise<void> {
  const config = getConfig();
  const t = tOf(config.system.language);
  const [state, settingsVisible] = await Promise.all([readState(), isSettingsVisible()]);

  const visible: Record<TrayMenuItemId, boolean> = {
    settings: settingsVisible,
    statusBar: state.statusBar,
    inventory: state.inventory,
    crosshair: config.hudElements.crosshairVisible,
    desktopIcons: state.desktopIcons
  };

  const items: MenuItemSpec[] = [];
  for (const entry of config.tray.menu) {
    if (!entry.visible) continue;
    items.push({ id: entry.id, label: trayMenuEntryLabel(t, entry.id, visible[entry.id]) });
  }
  items.push({ id: "exit", label: t("tray.itemExit") });

  const selected = await showTrayMenuAt(items, position.x, position.y, trayMenuWidth(items)).catch(
    () => null
  );
  if (!selected) return;
  if (selected === "exit") {
    await invoke("exit_app").catch(() => undefined);
    return;
  }
  await executeMenuAction(selected as TrayMenuItemId, visible);
}

/** 菜单文案展示的是当前真实状态，执行时按相反状态操作，避免配置与实际不一致 */
async function executeMenuAction(
  id: TrayMenuItemId,
  visible: Record<TrayMenuItemId, boolean>
): Promise<void> {
  switch (id) {
    case "settings":
      await setSettingsVisible(!visible.settings);
      return;
    case "statusBar":
      await setStatusBarVisible(!visible.statusBar);
      return;
    case "inventory":
      await setInventoryVisible(!visible.inventory);
      return;
    case "crosshair":
      await setCrosshairVisible(!visible.crosshair);
      return;
    case "desktopIcons":
      await invoke("toggle_desktop_icons").catch(() => undefined);
      return;
  }
}

const CJK = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/;

/** 按当前字号估算最宽文案，宽度在 160 到 320 之间 */
function trayMenuWidth(items: MenuItemSpec[]): number {
  const fontSize = getConfig().appearance.fontSize;
  const widest = items.reduce((max, item) => {
    let units = 0;
    for (const ch of item.label) units += CJK.test(ch) ? 1 : 0.6;
    return Math.max(max, units * fontSize);
  }, 0);
  return Math.min(320, Math.max(160, Math.ceil(widest) + 44));
}

async function execute(action: TrayAction, position: TrayPointer): Promise<void> {
  switch (action) {
    case "none":
      return;
    case "menu":
      await openContextMenu(position);
      return;
    case "settings":
    case "statusBar":
    case "inventory":
    case "crosshair":
      await applyWindowAction(action);
      return;
    case "desktopIcons":
      await invoke("toggle_desktop_icons").catch(() => undefined);
      return;
    default:
      return;
  }
}

/** 单击只在双击绑定了动作时等待系统双击间隔，否则立即执行 */
function handleLeftClick(position: TrayPointer): void {
  const clicks = getConfig().tray.clicks;
  const now = Date.now();
  const hasDouble = clicks.double !== "none";

  if (hasDouble && lastLeftUp !== 0 && now - lastLeftUp <= doubleClickMs) {
    lastLeftUp = 0;
    if (pendingSingle !== null) {
      window.clearTimeout(pendingSingle);
      pendingSingle = null;
    }
    void execute(clicks.double, position);
    return;
  }

  lastLeftUp = now;
  if (clicks.single === "none") return;

  if (!hasDouble) {
    void execute(clicks.single, position);
    return;
  }

  if (pendingSingle !== null) window.clearTimeout(pendingSingle);
  pendingSingle = window.setTimeout(() => {
    pendingSingle = null;
    lastLeftUp = 0;
    void execute(clicks.single, position);
  }, doubleClickMs);
}

/** 主窗口启动时调用，返回取消订阅函数 */
export function initializeTray(): () => void {
  if (!isTauri() || initialized) return () => undefined;
  initialized = true;

  void readState().then((state) => {
    if (state.doubleClickMs > 0) doubleClickMs = state.doubleClickMs;
  });

  let disposed = false;
  let unlisten: (() => void) | null = null;

  void listen<TrayPointer>("tray-pointer", ({ payload }) => {
    if (payload.button === "left") {
      handleLeftClick(payload);
      return;
    }
    const clicks = getConfig().tray.clicks;
    void execute(payload.button === "right" ? clicks.right : clicks.middle, payload);
  }).then((dispose) => {
    if (disposed) dispose();
    else unlisten = dispose;
  });

  return () => {
    disposed = true;
    unlisten?.();
    unlisten = null;
    initialized = false;
    lastLeftUp = 0;
    if (pendingSingle !== null) {
      window.clearTimeout(pendingSingle);
      pendingSingle = null;
    }
  };
}
