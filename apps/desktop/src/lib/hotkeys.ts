/** 全局热键：注册配置中的组合键并映射到窗口动作；录制期间整体暂停 */

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getConfig, subscribeConfig } from "@/config/appConfig";
import { applyWindowAction } from "@/lib/windowControls";

export const HOTKEY_EVENT = "craftsharp-hotkey";
export const HOTKEY_FAILURES_EVENT = "craftsharp-hotkey-failures";
export const HOTKEY_RECORDING_EVENT = "craftsharp-hotkey-recording";

const RELOAD_DEBOUNCE_MS = 300;
const ACTIONS = ["settings", "statusBar", "inventory", "crosshair"] as const;
const DESKTOP_ICONS_INDEX = 4;

let started = false;
let timer = 0;
let recording = false;
/** 最近一次发送给 Rust 的组合签名；录制暂停时置空，表示当前没有注册 */
let applied = "";

function specsNow(): string[] {
  const hotkeys = getConfig().hotkeys;
  return [hotkeys.settings, hotkeys.statusBar, hotkeys.inventory, hotkeys.crosshair, hotkeys.desktopIcons];
}

function send(specs: string[]) {
  return invoke("register_hotkeys", { actions: specs }).catch(() => undefined);
}

async function apply() {
  if (recording) return;
  const specs = specsNow();
  const signature = specs.join("|");
  if (signature === applied) return;
  applied = signature;
  await send(specs);
}

/** 录制时注销全部全局热键，结束后按当前配置恢复；所有窗口同步录制状态 */
export function setHotkeyRecording(active: boolean) {
  if (recording === active) return;
  recording = active;
  applied = "";
  void emit(HOTKEY_RECORDING_EVENT, active).catch(() => undefined);
  if (active) void send(["", "", "", "", ""]);
  else void apply();
}

export function isHotkeyRecording(): boolean {
  return recording;
}

/** 主窗口启动时调用一次 */
export function initializeHotkeys() {
  if (started || !("__TAURI_INTERNALS__" in window)) return;
  started = true;

  void apply();

  void listen<number>(HOTKEY_EVENT, (event) => {
    if (event.payload === DESKTOP_ICONS_INDEX) {
      void invoke("toggle_desktop_icons").catch(() => undefined);
      return;
    }
    const action = ACTIONS[event.payload];
    if (action) void applyWindowAction(action);
  });

  // 录制发生在设置窗口，这里同步暂停局部快捷键并让自己的缓存失效
  void listen<boolean>(HOTKEY_RECORDING_EVENT, (event) => {
    recording = event.payload;
    applied = "";
  });

  subscribeConfig(() => {
    if (recording) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void apply(), RELOAD_DEBOUNCE_MS);
  });
}
