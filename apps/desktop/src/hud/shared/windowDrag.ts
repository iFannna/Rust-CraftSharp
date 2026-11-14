/** 窗口拖动：Rust 侧按物理像素跟随系统光标，前端不参与逐帧位移 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 开始拖动当前窗口，松开左键返回结束位置，逻辑像素。
 * Rust 每 4ms 读一次光标并把窗口移到相同位移，避免 DPI 取整抖动。
 */
export async function startWindowDrag(): Promise<{ x: number; y: number } | null> {
  const current = getCurrentWindow();
  const end = await invoke<[number, number] | null>("drag_window", { label: current.label }).catch(() => null);
  if (!end) return null;

  const factor = await current.scaleFactor();
  return {
    x: Math.round(end[0] / factor),
    y: Math.round(end[1] / factor)
  };
}
