/** 非模态独立窗口：按锚点居中、隐藏创建后显示，已打开时由调用方复用 */

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "@/lib/runtime";

/** 锚点窗口居中，未指定或窗口不存在时回落到屏幕居中 */
export async function windowPosition(
  anchor: string | undefined,
  width: number,
  height: number
): Promise<{ x: number; y: number }> {
  if (anchor) {
    const target = await WebviewWindow.getByLabel(anchor).catch(() => null);
    if (target) {
      try {
        const [scale, position, size, visible, minimized] = await Promise.all([
          target.scaleFactor(),
          target.outerPosition(),
          target.outerSize(),
          target.isVisible(),
          target.isMinimized()
        ]);
        if (!visible || minimized) throw new Error("anchor hidden");
        return {
          x: Math.round((position.x + (size.width - width * scale) / 2) / scale),
          y: Math.round((position.y + (size.height - height * scale) / 2) / scale)
        };
      } catch {
        // 锚点窗口在取坐标时被关闭，回落到屏幕居中
      }
    }
  }

  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  return {
    x: (screen.availLeft ?? 0) + Math.round((screen.availWidth - width) / 2),
    y: (screen.availTop ?? 0) + Math.round((screen.availHeight - height) / 2)
  };
}

export async function findAppWindow(label: string): Promise<WebviewWindow | null> {
  if (!isTauri()) return null;
  return WebviewWindow.getByLabel(label).catch(() => null);
}

export async function focusAppWindow(target: WebviewWindow): Promise<void> {
  await target.show().catch(() => undefined);
  await target.setFocus().catch(() => undefined);
}

export interface AppWindowOptions {
  label: string;
  title: string;
  page: string;
  params?: Record<string, string>;
  width: number;
  height: number;
  /** 指定后居中于该窗口，否则居中于屏幕 */
  anchor?: string;
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
}

/** 创建隐藏窗口，页面挂载后显示，避免先出现空白帧 */
export async function openAppWindow(options: AppWindowOptions): Promise<WebviewWindow | null> {
  if (!isTauri()) return null;
  const screen = window.screen;
  const width = Math.min(options.width, screen.availWidth - 40);
  const height = Math.min(options.height, screen.availHeight - 40);
  const { x, y } = await windowPosition(options.anchor, width, height);
  const target = new WebviewWindow(options.label, {
    url: `pages/${options.page}.html?${new URLSearchParams(options.params ?? {}).toString()}`,
    title: options.title,
    x,
    y,
    width,
    height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    visible: false,
    transparent: false,
    decorations: false,
    shadow: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: options.resizable ?? false,
    focus: true
  });

  // 页面异常时兜底显示，避免窗口一直隐藏
  window.setTimeout(() => {
    void target.show().catch(() => undefined);
  }, 2000);

  return target;
}
