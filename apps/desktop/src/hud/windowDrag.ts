/** 自绘窗口拖动：按指针位移逐帧移动窗口，避免原生标题栏拖动在无边框窗口上的偏移 */

import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  origin: { x: number; y: number };
  position: { x: number; y: number };
  frame: number;
  resolve: (position: { x: number; y: number } | null) => void;
}

let session: DragSession | null = null;

function onMove(event: PointerEvent) {
  if (!session || event.pointerId !== session.pointerId) return;
  session.position = {
    x: Math.round(session.origin.x + (event.screenX - session.startX)),
    y: Math.round(session.origin.y + (event.screenY - session.startY))
  };
  if (session.frame) return;

  session.frame = requestAnimationFrame(() => {
    if (!session) return;
    session.frame = 0;
    const target = session.position;
    void getCurrentWindow().setPosition(new LogicalPosition(target.x, target.y)).catch(() => undefined);
  });
}

function finish(commit: boolean) {
  if (!session) return;
  const current = session;
  session = null;
  if (current.frame) cancelAnimationFrame(current.frame);
  window.removeEventListener("pointermove", onMove, true);
  window.removeEventListener("pointerup", onUp, true);
  window.removeEventListener("pointercancel", onCancel, true);
  current.resolve(commit ? current.position : null);
}

function onUp(event: PointerEvent) {
  if (session && event.pointerId === session.pointerId) finish(true);
}

function onCancel() {
  finish(false);
}

/**
 * 在 pointerdown 时调用，返回拖动结束后的逻辑像素位置。
 * 指针先抬起、没有真正开始拖动时返回 null。
 */
export function startWindowDrag(event: PointerEvent): Promise<{ x: number; y: number } | null> {
  if (session) return Promise.resolve(null);

  const element = event.currentTarget as HTMLElement | null;
  const pointerId = event.pointerId;
  const startX = event.screenX;
  const startY = event.screenY;

  return new Promise((resolve) => {
    let released = false;
    const onEarlyUp = () => {
      released = true;
    };
    window.addEventListener("pointerup", onEarlyUp, { capture: true, once: true });

    void (async () => {
      const current = getCurrentWindow();
      const [outer, factor] = await Promise.all([current.outerPosition(), current.scaleFactor()]);
      window.removeEventListener("pointerup", onEarlyUp, true);
      if (released) {
        resolve(null);
        return;
      }

      session = {
        pointerId,
        startX,
        startY,
        origin: { x: outer.x / factor, y: outer.y / factor },
        position: { x: Math.round(outer.x / factor), y: Math.round(outer.y / factor) },
        frame: 0,
        resolve
      };

      if (element) {
        try {
          element.setPointerCapture(pointerId);
        } catch {
          // 窗口失焦时捕获会失败，窗口级监听仍可收到事件
        }
      }
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
    })();
  });
}
