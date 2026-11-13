import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig } from "./config/appConfig";
import { loadImage } from "./hud/assets";
import { isPathMissing, loadSlotIcon } from "./hud/iconService";
import { getInventoryConfig, subscribeInventoryConfig, updateInventoryConfig } from "./hud/inventoryConfig";
import { InventoryInteraction, type InventoryHost } from "./hud/inventoryInteraction";
import { computeInventoryLayout, type InventoryLayout, type SlotBox } from "./hud/inventoryLayout";
import { drawInventory } from "./hud/inventoryRenderer";
import { findContainerStyle, type ContainerStyle } from "./hud/inventoryStyles";
import { getClipboard, openItem, subscribeClipboard, type SlotScope } from "./hud/slotActions";
import { showSlotMenu } from "./hud/slotMenu";
import { buildSlotMenuItems, runSlotMenuAction } from "./hud/slotMenuActions";
import {
  clearSlotFor,
  getSlotFor,
  setSlotFor,
  subscribeSlots,
  swapSlotsFor
} from "./hud/slotStore";
import type { SlotIcon } from "./hud/statusbar";
import { buildTooltipLines } from "./hud/tooltipContent";

const params = new URLSearchParams(location.search);
const forcedScale = Number(params.get("scale"));
const scale = Number.isFinite(forcedScale) && forcedScale > 0
  ? forcedScale
  : Math.max(1, (window.screen.width / 2560) * 6);

const canvasNode = document.querySelector<HTMLCanvasElement>("#inventory");
if (!canvasNode) throw new Error("物品栏画布缺失");
const canvas: HTMLCanvasElement = canvasNode;

const tauriWindow = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
const currentWindow = getCurrentWindow();

let config = getInventoryConfig();
let style: ContainerStyle = findContainerStyle(params.get("style") ?? config.style);
let background = await loadImage(style.url);
let layout: InventoryLayout = computeInventoryLayout(scale, style, naturalWidth(background), naturalHeight(background));
let icons = new Map<string, SlotIcon | null>();
let iconGeneration = 0;
let dimmedSlot: string | null = null;
let interaction: InventoryInteraction | null = null;

function naturalWidth(image: HTMLImageElement): number {
  return image.naturalWidth || image.width;
}

function naturalHeight(image: HTMLImageElement): number {
  return image.naturalHeight || image.height;
}

function scope(): SlotScope {
  return { style: style.file, shared: config.sharedData };
}

const TOOLTIP_LABEL = "tooltip";
let tooltipGeneration = 0;

/** tooltip 是独立窗口，浏览器预览时没有它，直接跳过 */
function hideTooltip() {
  tooltipGeneration += 1;
  if (!tauriWindow) return;
  void emitTo(TOOLTIP_LABEL, "tooltip:hide").catch(() => undefined);
}

async function showTooltip(slotId: string, box: SlotBox) {
  if (!tauriWindow) return;

  const inventory = getConfig().inventory;
  if (!inventory.showTooltip) return;

  const item = getSlotFor(slotId, style.file, config.sharedData);
  if (!item) return;

  const generation = ++tooltipGeneration;
  const lines = buildTooltipLines(item, {
    missing: isPathMissing(item.path),
    showFileName: inventory.tooltipShowFileName,
    showOriginalName: inventory.tooltipShowOriginalName,
    showFilePath: inventory.tooltipShowFilePath,
    showFileType: inventory.tooltipShowFileType,
    fileNameColor: inventory.fileNameColor
  });

  try {
    const factor = await currentWindow.scaleFactor();
    const origin = await currentWindow.outerPosition();
    if (generation !== tooltipGeneration) return;

    // 物品栏窗口原点 + 格子画布坐标，全部为逻辑像素
    const left = origin.x / factor;
    const top = origin.y / factor;
    const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
    const areaLeft = screen.availLeft ?? 0;
    const areaTop = screen.availTop ?? 0;

    await emitTo(TOOLTIP_LABEL, "tooltip:content", {
      lines,
      scale,
      anchor: { x: left + box.left, y: top + box.top, width: box.width, height: box.height },
      screen: {
        left: areaLeft,
        top: areaTop,
        right: areaLeft + screen.availWidth,
        bottom: areaTop + screen.availHeight
      }
    });
  } catch (error) {
    console.warn("Tooltip 显示失败", error);
  }
}

function render() {
  const state = interaction?.state;
  drawInventory(canvas, {
    layout,
    background,
    icons,
    hoverSlot: state?.hoverSlot ?? null,
    hoverPhase: interaction?.hoverPhase() ?? "white",
    drag: state?.drag?.icon ? { icon: state.drag.icon, x: state.drag.x, y: state.drag.y } : null,
    dragSourceSlot: state?.drag?.source ?? null,
    dimmedSlot
  });
}

async function refreshIcons() {
  const generation = ++iconGeneration;
  const slotScope = scope();

  const entries = await Promise.all(
    layout.slots.map(async (slot) => {
      const item = getSlotFor(slot.id, slotScope.style, slotScope.shared);
      const icon = item ? await loadSlotIcon({ path: item.path, showTargetIcon: false }) : null;
      return [slot.id, icon] as const;
    })
  );

  if (generation !== iconGeneration) return;
  icons = new Map(entries);
  render();
}

async function rebuildLayout(next: ContainerStyle) {
  style = next;
  background = await loadImage(style.url);
  layout = computeInventoryLayout(scale, style, naturalWidth(background), naturalHeight(background));
  hideTooltip();
  interaction?.destroy();
  interaction = new InventoryInteraction(canvas, buildHost());
  interaction.attach();
  await applyWindowGeometry();
  await refreshIcons();
}

function buildHost(): InventoryHost {
  return {
    layout: () => layout,
    getItem: (slotId) => getSlotFor(slotId, style.file, config.sharedData),
    getIcon: (slotId) => icons.get(slotId) ?? null,
    requestRender: render,
    openSlot: (slotId) => {
      const item = getSlotFor(slotId, style.file, config.sharedData);
      if (item) void openItem(slotId, item, scope());
    },
    deleteSlot: (slotId) => clearSlotFor(slotId, style.file, config.sharedData),
    swapSlots: (source, target) => swapSlotsFor(source, target, style.file, config.sharedData),
    moveToCategory: (slotId) => executeShiftMove(slotId),
    distributeTo: (slotId, path) => {
      if (getSlotFor(slotId, style.file, config.sharedData)) return;
      setSlotFor(slotId, { path }, style.file, config.sharedData);
    },
    openMenu: (slotId, clientX, clientY) => {
      void (async () => {
        const item = getSlotFor(slotId, style.file, config.sharedData);
        const items = await buildSlotMenuItems(item, scope());
        const action = await showSlotMenu(items, clientX, clientY);
        if (action) await runSlotMenuAction(action, slotId, item, scope());
      })();
    },
    beginWindowDrag: () => {
      if (config.lockPosition) return;
      void currentWindow.startDragging();
    },
    hoverEnabled: () => config.hoverEffect,
    clickMode: () => config.clickMode,
    showTooltip: (slotId, box) => {
      void showTooltip(slotId, box);
    },
    hideTooltip: () => {
      hideTooltip();
    }
  };
}

type SlotCategory = "hotbar" | "inventory" | "armor" | "craft" | "offhand" | "other";

function categoryOf(slotId: string): SlotCategory {
  if (slotId.startsWith("hotbar_")) return "hotbar";
  if (slotId.startsWith("inventory_")) return "inventory";
  if (slotId === "helmet" || slotId === "chestplate" || slotId === "leggings" || slotId === "boots") return "armor";
  if (slotId.startsWith("craft_") || slotId === "craft_result") return "craft";
  if (slotId === "offhand") return "offhand";
  return "other";
}

function findFirstEmpty(category: "hotbar" | "inventory"): string | null {
  const slotScope = scope();
  const ids = category === "hotbar"
    ? Array.from({ length: 9 }, (_, index) => `hotbar_${index}`)
    : Array.from({ length: 27 }, (_, index) => `inventory_${index}`);

  for (const slotId of ids) {
    if (!getSlotFor(slotId, slotScope.style, slotScope.shared)) return slotId;
  }
  return null;
}

/** 与原实现一致：快捷栏与背包互换首个空位，装备/合成/副手移到背包首个空位 */
function executeShiftMove(slotId: string) {
  const slotScope = scope();
  const item = getSlotFor(slotId, slotScope.style, slotScope.shared);
  if (!item) return;

  const category = categoryOf(slotId);
  if (category === "other") return;

  const targetCategory = category === "inventory" ? "hotbar" : "inventory";
  const target = findFirstEmpty(targetCategory);
  if (!target) return;

  setSlotFor(target, item, slotScope.style, slotScope.shared);
  clearSlotFor(slotId, slotScope.style, slotScope.shared);
}

async function applyWindowGeometry() {
  if (!tauriWindow) return;

  await currentWindow.setSize(new LogicalSize(Math.ceil(layout.width), Math.ceil(layout.height)));

  const saved = config.rememberPosition ? config.position : null;
  if (saved) {
    await currentWindow.setPosition(new LogicalPosition(saved.x, saved.y));
    return;
  }

  const screen = window.screen as Screen & { availTop?: number };
  const x = Math.round((screen.availWidth - layout.width) / 2);
  const y = Math.round((screen.availTop ?? 0) + (screen.availHeight - layout.height) / 2);
  await currentWindow.setPosition(new LogicalPosition(x, y));
}

interaction = new InventoryInteraction(canvas, buildHost());
interaction.attach();

subscribeSlots(() => {
  void refreshIcons().then(() => interaction?.refreshTooltip());
});

subscribeClipboard(() => {
  const clipboard = getClipboard();
  dimmedSlot = clipboard && clipboard.cut ? clipboard.slotId : null;
  render();
});

subscribeInventoryConfig(() => {
  const next = getInventoryConfig();
  const styleChanged = next.style !== style.file;
  config = next;

  // 开关或颜色变化后即时生效
  if (!getConfig().inventory.showTooltip) {
    hideTooltip();
  } else {
    interaction?.refreshTooltip();
  }

  if (styleChanged) {
    void rebuildLayout(findContainerStyle(next.style));
    return;
  }
  void refreshIcons();
});

if (tauriWindow) {
  void applyWindowGeometry();

  // 物品栏窗口被隐藏或最小化时不留悬浮提示
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hideTooltip();
  });

  void currentWindow.onMoved(({ payload }) => {
    void (async () => {
      if (!config.rememberPosition) return;
      const factor = await currentWindow.scaleFactor();
      const point = payload as { x: number; y: number };
      updateInventoryConfig({ position: { x: Math.round(point.x / factor), y: Math.round(point.y / factor) } });
    })();
  });
}


void refreshIcons();
render();
document.body.dataset.ready = "true";
