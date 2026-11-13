/** 全局热键：注册配置中的组合键并把触发映射到窗口开关 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getConfig, subscribeConfig } from "./config/appConfig";
import { toggleCrosshair, toggleInventory, toggleSettings, toggleStatusBar } from "./windowControls";

const EVENT_NAME = "craftsharp-hotkey";
const RELOAD_DEBOUNCE_MS = 300;

const actions = ["settings", "statusBar", "inventory", "crosshair"] as const;
type HotkeyAction = (typeof actions)[number];

let started = false;
let reloadTimer = 0;

async function applyHotkeys() {
  const hotkeys = getConfig().hotkeys;
  const specs = [hotkeys.settings, hotkeys.statusBar, hotkeys.inventory, hotkeys.crosshair];
  const failed = await invoke<string[]>("register_hotkeys", { actions: specs }).catch(() => []);
  if (failed.length > 0) {
    console.warn("以下热键注册失败", failed);
  }
}

function runAction(action: HotkeyAction) {
  switch (action) {
    case "settings":
      void toggleSettings();
      break;
    case "statusBar":
      void toggleStatusBar();
      break;
    case "inventory":
      void toggleInventory();
      break;
    case "crosshair":
      void toggleCrosshair();
      break;
    default:
      break;
  }
}

/** 主窗口启动时调用一次 */
export function initializeHotkeys() {
  if (started || !("__TAURI_INTERNALS__" in window)) return;
  started = true;

  void applyHotkeys();

  void listen<string>(EVENT_NAME, (event) => {
    if ((actions as readonly string[]).includes(event.payload)) {
      runAction(event.payload as HotkeyAction);
    }
  });

  subscribeConfig(() => {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => void applyHotkeys(), RELOAD_DEBOUNCE_MS);
  });
}
