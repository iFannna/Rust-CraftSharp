/** 局部快捷键：应用窗口聚焦时生效，状态栏由 Rust 原生输入处理 */

import { getConfig } from "@/config/appConfig";
import { setInventoryVisible, toggleInventory } from "@/lib/windowControls";

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
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (typingInField(event.target)) return;

    if (event.key === "Escape") {
      void closeInventory().then((closed) => {
        if (closed) event.preventDefault();
      });
      return;
    }

    const key = getConfig().hotkeys.openInventory;
    if (!key || event.repeat || event.key.toLowerCase() !== key.toLowerCase()) return;

    event.preventDefault();
    void toggleInventory();
  });
}
