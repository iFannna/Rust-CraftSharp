import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface MenuItemSpec {
  id: string;
  label: string;
  disabled?: boolean;
  separator?: boolean;
}

const MENU_WIDTH = 208;
const ITEM_HEIGHT = 32;
const SEPARATOR_HEIGHT = 9;
/** 上下内边距合计 p-1，另加 1px 边框 */
const PADDING = 8;
const BORDER = 2;
const MENU_LABEL = "slot-menu";

export function menuHeight(items: MenuItemSpec[]): number {
  const itemsHeight = items.reduce(
    (total, item) => total + (item.separator ? SEPARATOR_HEIGHT : ITEM_HEIGHT),
    0
  );
  return itemsHeight + PADDING + BORDER;
}

/**
 * 在窗口内坐标位置弹出格子菜单，返回被选中的菜单项 id。
 * 菜单是独立窗口，可以超出 HUD 边界显示。
 */
export async function showSlotMenu(
  items: MenuItemSpec[],
  clientX: number,
  clientY: number
): Promise<string | null> {
  const current = getCurrentWindow();
  const outer = await current.outerPosition();
  const scale = await current.scaleFactor();
  return showSlotMenuAt(items, outer.x + clientX * scale, outer.y + clientY * scale);
}

/** 按屏幕物理像素弹出菜单，供原生状态栏使用。 */
export async function showSlotMenuAt(
  items: MenuItemSpec[],
  physicalXIn: number,
  physicalYIn: number
): Promise<string | null> {
  const existing = await WebviewWindow.getByLabel(MENU_LABEL);
  if (existing) await existing.close().catch(() => undefined);

  const current = getCurrentWindow();
  const scale = await current.scaleFactor();
  const width = MENU_WIDTH;
  const height = menuHeight(items);
  const physicalWidth = width * scale;
  const physicalHeight = height * scale;

  const workRight = window.screen.availWidth * scale;
  const workTop = ((window.screen as Screen & { availTop?: number }).availTop ?? 0) * scale;
  const workBottom = workTop + window.screen.availHeight * scale;

  let physicalX = physicalXIn;
  let physicalY = physicalYIn;

  if (physicalX + physicalWidth > workRight - 4) {
    physicalX = Math.max(4, workRight - physicalWidth - 4);
  }
  if (physicalY + physicalHeight > workBottom - 4) {
    physicalY = Math.max(workTop + 4, physicalY - physicalHeight);
  }

  let selectedId: string | null = null;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let unlisten: (() => void) | null = null;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      unlisten?.();
      resolve(value);
    };

    const menu = new WebviewWindow(MENU_LABEL, {
      url: `pages/menu.html?items=${encodeURIComponent(JSON.stringify(items))}`,
      x: physicalX / scale,
      y: physicalY / scale,
      width,
      height,
      // 页面挂载后由 useRevealWindow 显示，避免空白帧
      visible: false,
      transparent: true,
      decorations: false,
      shadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focus: true
    });

    // 页面异常时兜底显示，避免菜单一直隐藏
    window.setTimeout(() => {
      void menu.show().catch(() => undefined);
    }, 2000);

    menu.once("tauri://error", () => finish(null));
    void menu.once("tauri://destroyed", () => finish(selectedId));

    void listen<string>("menu:select", (event) => {
      selectedId = event.payload;
      finish(event.payload);
      void menu.close().catch(() => undefined);
    }).then((dispose) => {
      if (settled) dispose();
      else unlisten = dispose;
    });
  });
}
