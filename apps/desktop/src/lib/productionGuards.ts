/** 打包后屏蔽 WebView2 自带的右键菜单、刷新与调试快捷键 */

const blockedSingleKeys = new Set(["F5", "F12", "F7"]);
const blockedCtrlKeys = new Set(["r", "u", "p", "s"]);
const blockedCtrlShiftKeys = new Set(["i", "j", "c", "k"]);

function isBlockedShortcut(event: KeyboardEvent): boolean {
  if (blockedSingleKeys.has(event.key)) return true;
  if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return true;
  if (!(event.ctrlKey || event.metaKey)) return false;
  const key = event.key.toLowerCase();
  if (event.shiftKey && blockedCtrlShiftKeys.has(key)) return true;
  return blockedCtrlKeys.has(key);
}

export function installProductionGuards() {
  if (import.meta.env.DEV) return;
  if (!("__TAURI_INTERNALS__" in window)) return;

  // 捕获阶段只拦默认行为，页面自定义右键菜单仍能收到事件
  window.addEventListener("contextmenu", (event) => event.preventDefault(), true);

  window.addEventListener(
    "keydown",
    (event) => {
      if (!isBlockedShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );
}
