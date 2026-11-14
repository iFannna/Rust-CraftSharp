/** 全局热键：注册配置中的组合键并把触发映射到窗口开关 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getConfig, subscribeConfig } from "@/config/appConfig";
import { applyWindowAction } from "@/lib/windowControls";

const EVENT_NAME = "craftsharp-hotkey";
const RELOAD_DEBOUNCE_MS = 300;
const FAILURE_KEY = "craftsharp.hotkeyFailures";

const actions = ["settings", "statusBar", "inventory", "crosshair"] as const;
const DESKTOP_ICONS_INDEX = 4;

let started = false;
let reloadTimer = 0;
let appliedSpecs = "";

function specsNow(): string[] {
  const hotkeys = getConfig().hotkeys;
  return [hotkeys.settings, hotkeys.statusBar, hotkeys.inventory, hotkeys.crosshair, hotkeys.desktopIcons];
}

async function applyHotkeys() {
  const specs = specsNow();
  const signature = specs.join("|");
  if (signature === appliedSpecs) return;
  appliedSpecs = signature;

  const failed = await invoke<string[]>("register_hotkeys", { actions: specs }).catch(() => []);
  if (failed.length > 0) {
    console.warn("以下热键注册失败", failed);
  }
  // 设置面板在独立窗口，用共享存储转达注册失败项
  try {
    localStorage.setItem(FAILURE_KEY, JSON.stringify(failed));
  } catch {
    // 存储不可用时只是设置面板看不到提示
  }
}

/** 主窗口启动时调用一次 */
export function initializeHotkeys() {
  if (started || !("__TAURI_INTERNALS__" in window)) return;
  started = true;

  void applyHotkeys();

  void listen<number>(EVENT_NAME, (event) => {
    if (event.payload === DESKTOP_ICONS_INDEX) {
      void invoke("toggle_desktop_icons").catch(() => undefined);
      return;
    }
    const action = actions[event.payload];
    if (action) void applyWindowAction(action);
  });

  subscribeConfig(() => {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => void applyHotkeys(), RELOAD_DEBOUNCE_MS);
  });
}
