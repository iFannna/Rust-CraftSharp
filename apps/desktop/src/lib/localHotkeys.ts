/** 局部快捷键：应用窗口聚焦时生效，状态栏由 Rust 原生输入处理 */

import { getConfig } from "@/config/appConfig";
import { isHotkeyRecording } from "@/lib/hotkeys";
import { setInventoryVisible, toggleInventory } from "@/lib/windowControls";
import { captureHotkey, normalizeHotkey } from "@/settings/hotkey";

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

export function installLocalHotkeys() {
  if (!("__TAURI_INTERNALS__" in window)) return;

  window.addEventListener("keydown", (event) => {
    if (isHotkeyRecording()) return;
    if (event.metaKey) return;
    if (typingInField(event.target)) return;

    if (event.key === "Escape") {
      if (event.ctrlKey || event.altKey || event.shiftKey) return;
      void closeInventory().then((closed) => {
        if (closed) event.preventDefault();
      });
      return;
    }

    const hotkey = getConfig().hotkeys.openInventory;
    if (!hotkey || event.repeat) return;

    // 修饰键必须完全一致，Shift+E 不能触发 E
    const captured = captureHotkey(event);
    if (!captured.text || normalizeHotkey(captured.text) !== normalizeHotkey(hotkey)) return;

    event.preventDefault();
    void toggleInventory();
  });
}
