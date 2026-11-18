/** 应用快捷键：所有可聚焦窗口共用；本进程窗口聚焦时由页面处理，外部交给系统钩子 */

import { invoke } from "@tauri-apps/api/core";
import { getConfig } from "@/config/appConfig";
import { isHotkeyRecording } from "@/lib/hotkeys";
import {
  applyWindowAction,
  setInventoryVisible,
  toggleInventory,
  type WindowAction
} from "@/lib/windowControls";
import {
  MAX_HOTKEY_KEYS,
  hotkeysMatch,
  keyFromEvent,
  sequenceText,
  type SequenceKey
} from "@/settings/hotkey";

const GLOBAL_ITEMS: { key: "settings" | "statusBar" | "inventory" | "crosshair" | "desktopIcons"; action: WindowAction | null }[] = [
  { key: "settings", action: "settings" },
  { key: "statusBar", action: "statusBar" },
  { key: "inventory", action: "inventory" },
  { key: "crosshair", action: "crosshair" },
  { key: "desktopIcons", action: null }
];

function typingInField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}

async function closeInventory(): Promise<boolean> {
  if (!getConfig().inventory.visible) return false;
  await setInventoryVisible(false);
  return true;
}

let installed = false;

/** dialog 只处理全局项，Esc 与物品栏开关交回窗口自己 */
export function installLocalHotkeys(options: { local?: boolean } = {}) {
  if (installed || !("__TAURI_INTERNALS__" in window)) return;
  installed = true;
  const local = options.local ?? true;

  const pressed = new Set<string>();
  let sequence: SequenceKey[] = [];
  let overflow = false;

  const reset = () => {
    pressed.clear();
    sequence = [];
    overflow = false;
  };

  window.addEventListener("keydown", (event) => {
    if (isHotkeyRecording() || typingInField(event.target)) {
      reset();
      return;
    }

    if (event.key === "Escape") {
      reset();
      if (!local || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      void closeInventory().then((closed) => {
        if (closed) event.preventDefault();
      });
      return;
    }

    // 按住不放的自动重复只算一次
    if (pressed.has(event.code)) return;
    pressed.add(event.code);

    if (pressed.size === 1) {
      sequence = [];
      overflow = false;
    }

    if (sequence.length >= MAX_HOTKEY_KEYS) {
      overflow = true;
      return;
    }

    const key = keyFromEvent(event, getConfig().system.distinguishModifiers);
    if (key) sequence.push(key);
  });

  window.addEventListener("keyup", (event) => {
    if (isHotkeyRecording()) {
      reset();
      return;
    }
    if (!pressed.has(event.code)) return;

    pressed.delete(event.code);
    if (pressed.size > 0) return;

    // 全部松开后按顺序判定；全局项优先于局部项
    const config = getConfig();
    const captured = !overflow && sequence.length > 0 ? sequenceText(sequence) : "";

    if (captured) {
      const global = GLOBAL_ITEMS.find((item) => hotkeysMatch(config.hotkeys[item.key], captured));
      if (global) {
        if (global.action) {
          void applyWindowAction(global.action);
        } else {
          void invoke("toggle_desktop_icons").catch(() => undefined);
        }
        reset();
        return;
      }

      if (local && hotkeysMatch(config.hotkeys.openInventory, captured)) {
        void toggleInventory();
      }
    }

    reset();
  });

  window.addEventListener("blur", reset);
}
