import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "@/lib/runtime";

const DIALOG_RESULT = "dialog:result";

export function emitDialogResult(label: string, value: unknown): void {
  if (!isTauri()) return;
  void emit(DIALOG_RESULT, { label, value });
}

async function closeWindow(label: string): Promise<void> {
  const target = await WebviewWindow.getByLabel(label).catch(() => null);
  await target?.close().catch(() => undefined);
}

export async function closeDialogWindow(label: string): Promise<void> {
  if (!isTauri()) return;
  await closeWindow(label);
}

/** 按锚点窗口居中，未指定或窗口不存在时回落到屏幕居中 */
async function centeredPosition(
  anchor: string | undefined,
  width: number,
  height: number
): Promise<{ x: number; y: number }> {
  if (anchor) {
    const target = await WebviewWindow.getByLabel(anchor).catch(() => null);
    if (target) {
      try {
        const [scale, position, size] = await Promise.all([
          target.scaleFactor(),
          target.outerPosition(),
          target.outerSize()
        ]);
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

interface DialogWindowOptions {
  label: string;
  title?: string;
  page: string;
  params?: Record<string, string>;
  width: number;
  height: number;
  /** dialog 只有关闭键且置顶；display 是可缩放的展示窗口 */
  mode?: "dialog" | "display";
  /** 覆盖默认置顶行为，用于从置顶窗口再打开子窗口 */
  alwaysOnTop?: boolean;
  minWidth?: number;
  minHeight?: number;
  /** 指定后居中于该窗口，否则居中于屏幕 */
  anchor?: string;
}

/** 打开一个独立弹窗，等待它通过 dialog:result 返回结果 */
export async function openDialogWindow<T>({
  label,
  title,
  page,
  params = {},
  width,
  height,
  mode = "dialog",
  alwaysOnTop,
  minWidth,
  minHeight,
  anchor
}: DialogWindowOptions): Promise<T | null> {
  if (!isTauri()) return null;

  await closeWindow(label);
  const { x, y } = await centeredPosition(anchor, width, height);

  return new Promise<T | null>((resolve) => {
    let settled = false;
    let unlisten: (() => void) | null = null;

    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      unlisten?.();
      void closeWindow(label);
      resolve(value);
    };

    void listen<{ label: string; value: T }>(DIALOG_RESULT, (event) => {
      if (event.payload.label !== label) return;
      finish(event.payload.value);
    }).then((dispose) => {
      if (settled) dispose();
      else unlisten = dispose;
    });

    const display = mode === "display";
    const dialog = new WebviewWindow(label, {
      url: `pages/${page}.html?${new URLSearchParams(params).toString()}`,
      title,
      x,
      y,
      width,
      height,
      minWidth,
      minHeight,
      transparent: true,
      decorations: false,
      shadow: true,
      alwaysOnTop: alwaysOnTop ?? !display,
      skipTaskbar: false,
      resizable: display,
      focus: true
    });

    dialog.once("tauri://error", () => finish(null));
    dialog.once("tauri://destroyed", () => finish(null));
  });
}
