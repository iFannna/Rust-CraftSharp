import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "@/lib/runtime";

const DIALOG_RESULT = "dialog:result";

export function emitDialogResult(label: string, value: unknown): void {
  if (!isTauri()) return;
  void emit(DIALOG_RESULT, { label, value });
}

/** 打开一个独立弹窗，等待它通过 dialog:result 返回结果 */
export async function openDialogWindow<T>({
  label,
  page,
  params = {},
  width,
  height
}: {
  label: string;
  page: string;
  params?: Record<string, string>;
  width: number;
  height: number;
}): Promise<T | null> {
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) await existing.close().catch(() => undefined);

  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  const x = (screen.availLeft ?? 0) + Math.round((screen.availWidth - width) / 2);
  const y = (screen.availTop ?? 0) + Math.round((screen.availHeight - height) / 2);

  return new Promise<T | null>((resolve) => {
    let settled = false;
    let unlisten: (() => void) | null = null;

    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      unlisten?.();
      void WebviewWindow.getByLabel(label)
        .then((dialog) => dialog?.close())
        .catch(() => undefined);
      resolve(value);
    };

    void listen<{ label: string; value: T }>(DIALOG_RESULT, (event) => {
      if (event.payload.label !== label) return;
      finish(event.payload.value);
    }).then((dispose) => {
      if (settled) dispose();
      else unlisten = dispose;
    });

    const dialog = new WebviewWindow(label, {
      url: `pages/${page}.html?${new URLSearchParams(params).toString()}`,
      x,
      y,
      width,
      height,
      transparent: true,
      decorations: false,
      shadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focus: true
    });

    dialog.once("tauri://error", () => finish(null));
    dialog.once("tauri://destroyed", () => finish(null));
  });
}
