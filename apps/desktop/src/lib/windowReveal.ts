import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/lib/runtime";

/**
 * 弹窗以隐藏状态创建，组件挂载后再显示，避免窗口先于首帧出现导致的空白闪烁。
 * 隐藏窗口创建时的 focus 不生效，显示后补发。
 */
export function useRevealWindow(): void {
  useEffect(() => {
    if (!isTauri()) return;
    const current = getCurrentWindow();
    void current
      .show()
      .then(() => current.setFocus())
      .catch(() => undefined);
  }, []);
}
