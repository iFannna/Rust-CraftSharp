import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/lib/runtime";

/** 同时更新页面标题和原生窗口标题，任务栏与 Alt+Tab 才会拿到同一份 i18n 文案 */
export function applyWindowTitle(title: string) {
  document.title = title;
  if (!isTauri()) return;
  void getCurrentWindow().setTitle(title).catch(() => undefined);
}
