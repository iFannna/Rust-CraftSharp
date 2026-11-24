export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Linux 的窗口没有 DWM 的圆角与描边，外壳改由页面自绘 */
export function isLinux(): boolean {
  return typeof navigator !== "undefined" && /Linux/i.test(navigator.userAgent);
}
