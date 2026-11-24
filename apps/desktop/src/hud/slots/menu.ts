import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface MenuItemSpec {
  id: string;
  label: string;
  disabled?: boolean;
  separator?: boolean;
}

type MenuKind = "slot" | "tray";

interface MenuMetrics {
  width: number;
  itemHeight: number;
  separatorHeight: number;
  /** 容器上下内边距与边框合计 */
  chrome: number;
  label: string;
  event: string;
}

const MENU_METRICS: Record<MenuKind, MenuMetrics> = {
  slot: {
    width: 208,
    itemHeight: 32,
    separatorHeight: 9,
    /** p-1 上下合计 8，加 1px 边框 */
    chrome: 10,
    label: "slot-menu",
    event: "menu:select"
  },
  tray: {
    width: 184,
    itemHeight: 40,
    separatorHeight: 9,
    /** p-1.5 上下合计 12，加 1px 边框 */
    chrome: 14,
    label: "tray-menu",
    event: "tray-menu:select"
  }
};

export function menuHeight(items: MenuItemSpec[], kind: MenuKind = "slot"): number {
  const metrics = MENU_METRICS[kind];
  const itemsHeight = items.reduce(
    (total, item) => total + (item.separator ? metrics.separatorHeight : metrics.itemHeight),
    0
  );
  return itemsHeight + metrics.chrome;
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
  return showMenuAt(items, physicalXIn, physicalYIn, "slot");
}

/** 托盘右键菜单，尺寸和事件通道与格子菜单分开；宽度由调用方按文案和字号估算。 */
export async function showTrayMenuAt(
  items: MenuItemSpec[],
  physicalXIn: number,
  physicalYIn: number,
  width?: number
): Promise<string | null> {
  return showMenuAt(items, physicalXIn, physicalYIn, "tray", width);
}

async function showMenuAt(
  items: MenuItemSpec[],
  physicalXIn: number,
  physicalYIn: number,
  kind: MenuKind,
  widthOverride?: number
): Promise<string | null> {
  const metrics = MENU_METRICS[kind];
  const existing = await WebviewWindow.getByLabel(metrics.label);
  if (existing) await existing.close().catch(() => undefined);

  const current = getCurrentWindow();
  const scale = await current.scaleFactor();
  const width = widthOverride ?? metrics.width;
  const height = menuHeight(items, kind);
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

    const menu = new WebviewWindow(metrics.label, {
      url: `pages/menu.html?variant=${kind}&items=${encodeURIComponent(JSON.stringify(items))}`,
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
      // Linux 的非可调整窗口会被 GTK 撑到最小默认高度，必须允许程序改高度
      resizable: true,
      focus: true
    });

    // 页面异常时兜底显示，避免菜单一直隐藏
    window.setTimeout(() => {
      void menu.show().catch(() => undefined);
    }, 2000);

    menu.once("tauri://error", () => finish(null));
    void menu.once("tauri://destroyed", () => finish(selectedId));

    void listen<string>(metrics.event, (event) => {
      selectedId = event.payload;
      finish(event.payload);
      void menu.close().catch(() => undefined);
    }).then((dispose) => {
      if (settled) dispose();
      else unlisten = dispose;
    });
  });
}
