import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig } from "@/config/appConfig";
import { loadImage } from "@/hud/statusbar/assets";
import { isPathMissing, loadSlotIcon } from "@/hud/statusbar/iconService";
import { getInventoryConfig, subscribeInventoryConfig, updateInventoryConfig } from "@/hud/inventory/config";
import { InventoryInteraction, type InventoryHost } from "@/hud/inventory/interaction";
import { computeInventoryLayout, type InventoryLayout, type SlotBox } from "@/hud/inventory/layout";
import { drawInventory } from "@/hud/inventory/renderer";
import { findContainerStyle, type ContainerStyle } from "@/hud/inventory/styles";
import { getClipboard, openItem, subscribeClipboard, type SlotScope } from "@/hud/slots/actions";
import { showSlotMenu } from "@/hud/slots/menu";
import { buildSlotMenuItems, runSlotMenuAction } from "@/hud/slots/menuActions";
import {
  clearSlotFor,
  getSlotFor,
  setSlotFor,
  subscribeSlots,
  swapSlotsFor
} from "@/hud/slots/store";
import type { SlotIcon } from "@/hud/slots/types";
import { buildTooltipLines } from "@/hud/tooltip/content";
import { clampToWorkArea } from "@/hud/shared/windowPlacement";
import { startWindowDrag } from "@/hud/shared/windowDrag";
import { createHitMask } from "@/lib/hitMask";
import { installLocalHotkeys } from "@/lib/localHotkeys";

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

// 局部快捷键与状态栏一致：E 开关物品栏、ESC 关闭
installLocalHotkeys();
const refreshHitMask = createHitMask(canvas, currentWindow.label);

let config = getInventoryConfig();
let style: ContainerStyle = findContainerStyle(params.get("style") ?? config.style);
let background = await loadImage(style.url);
let layout: InventoryLayout = computeInventoryLayout(scale, style, naturalWidth(background), naturalHeight(background));
let icons = new Map<string, SlotIcon | null>();
let iconGeneration = 0;
// 已交给系统拖放的格子，拖放结束前不参与图标刷新，避免旧图标闪回
let dragOutSlot: string | null = null;
let dimmedSlot: string | null = null;
let interaction: InventoryInteraction | null = null;
let appliedSize: { width: number; height: number } | null = null;
let appliedPosition: { x: number; y: number } | null = null;
let pendingPosition: { x: number; y: number } | null = null;
let persistTimer = 0;
let dragScaleFactor = window.devicePixelRatio || 1;
let dragging = false;

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
  // 拖动时恢复整窗区域，避免拖拽图标被窗口形状裁掉
  refreshHitMask(Boolean(state?.drag));
}

/** 把格子区域交给原生拖放，文件悬浮时按格子显示可放置光标与缩略图 */
function pushDropZones() {
  if (!tauriWindow) return;
  const pixel = window.devicePixelRatio || 1;
  const zones = layout.slots.map((slot) => ({
    id: slot.id,
    left: Math.round(slot.left * pixel),
    top: Math.round(slot.top * pixel),
    width: Math.round(slot.width * pixel),
    height: Math.round(slot.height * pixel)
  }));
  void invoke("set_drop_zones", { label: currentWindow.label, zones }).catch(() => undefined);
}

async function refreshIcons() {  const generation = ++iconGeneration;
  const slotScope = scope();

  const entries = await Promise.all(
    layout.slots.map(async (slot) => {
      const item = getSlotFor(slot.id, slotScope.style, slotScope.shared);
      const icon = item && slot.id !== dragOutSlot
        ? await loadSlotIcon({ path: item.path, showTargetIcon: false })
        : null;
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
  pushDropZones();
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
    startFileDrag: (slotId) => {
      const item = getSlotFor(slotId, style.file, config.sharedData);
      if (!item || isPathMissing(item.path)) return;

      // 交接瞬间先把图标从格子里拿掉，系统拖放开始时格子已经是空的
      const hidden = icons.get(slotId) ?? null;
      dragOutSlot = slotId;
      icons.delete(slotId);
      render();

      const size = Math.round(16 * scale * (window.devicePixelRatio || 1));
      void invoke<boolean>("begin_file_drag", { path: item.path, size })
        .then((dropped) => {
          dragOutSlot = null;
          if (dropped) {
            clearSlotFor(slotId, style.file, config.sharedData);
            return;
          }
          // 取消拖放，图标还回格子
          if (hidden) {
            icons.set(slotId, hidden);
            render();
          }
        })
        .catch(() => {
          dragOutSlot = null;
          if (hidden) {
            icons.set(slotId, hidden);
            render();
          }
        });
    },
    openMenu: (slotId, clientX, clientY) => {
      void (async () => {
        const item = getSlotFor(slotId, style.file, config.sharedData);
        const items = await buildSlotMenuItems(item, scope());
        const action = await showSlotMenu(items, clientX, clientY);
        if (action) await runSlotMenuAction(action, slotId, item, scope());
      })();
    },
    beginWindowDrag: (event) => {
      if (config.lockPosition) return;
      event.preventDefault();
      refreshHitMask(true);
      dragging = true;
      void startWindowDrag().then((position) => {
        dragging = false;
        refreshHitMask();
        if (!position) return;
        appliedPosition = position;
        pendingPosition = position;
        flushMoved();
      });
    },
    hoverEnabled: () => config.hoverEffect,
    clickMode: () => config.clickMode,
    dropKey: () => getConfig().hotkeys.dropItem,
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

function sameSpot(a: { x: number; y: number } | null, b: { x: number; y: number }) {
  return a !== null && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

// 自身 setPosition 也会触发 moved，命中同一点时不再回设，避免来回拉扯
async function moveWindowTo(target: { x: number; y: number }) {
  if (!tauriWindow || sameSpot(appliedPosition, target)) return;
  await currentWindow.setPosition(new LogicalPosition(target.x, target.y));
  appliedPosition = { x: target.x, y: target.y };
}

async function applyWindowGeometry() {
  if (!tauriWindow) return;

  const width = Math.ceil(layout.width);
  const height = Math.ceil(layout.height);
  if (!appliedSize || appliedSize.width !== width || appliedSize.height !== height) {
    await currentWindow.setSize(new LogicalSize(width, height));
    appliedSize = { width, height };
  }

  const saved = config.rememberPosition ? config.position : null;
  const target = saved ? clampToWorkArea(saved, layout.width, layout.height) : null;
  if (target) {
    await moveWindowTo(target);
    return;
  }

  const screen = window.screen as Screen & { availTop?: number };
  await moveWindowTo({
    x: Math.round((screen.availWidth - layout.width) / 2),
    y: Math.round((screen.availTop ?? 0) + (screen.availHeight - layout.height) / 2)
  });
}

function flushMoved() {
  if (dragging || !pendingPosition) return;
  const position = pendingPosition;
  pendingPosition = null;
  updateInventoryConfig({ position });
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

void listen<{ window: string; zone: string; paths: string[] }>("file-dropped", (event) => {
  const { window: source, zone, paths } = event.payload;
  if (source !== "inventory" || !zone || paths.length === 0) return;
  setSlotFor(zone, { path: paths[0] }, style.file, config.sharedData);
});

subscribeInventoryConfig(() => {
  const previous = config;
  const next = getInventoryConfig();
  const styleChanged = next.style !== style.file;
  const iconsRelevant = next.sharedData !== previous.sharedData;
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
  // 拖动位置回写不影响图标，避免每次移动重载图标导致卡顿
  if (iconsRelevant) void refreshIcons();
});

if (tauriWindow) {
  void applyWindowGeometry();
  await currentWindow.onScaleChanged(({ payload }) => {
    dragScaleFactor = payload.scaleFactor;
    pushDropZones();
  });

  // 物品栏窗口被隐藏或最小化时不留悬浮提示
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hideTooltip();
  });

  // 拖拽期间只记录位置，停下后再落盘，避免写配置触发窗口回位
  void currentWindow.onMoved(({ payload }) => {
    if (!config.rememberPosition) return;
    const point = payload as { x: number; y: number };
    const position = {
      x: Math.round(point.x / dragScaleFactor),
      y: Math.round(point.y / dragScaleFactor)
    };
    const echo = sameSpot(appliedPosition, position);
    appliedPosition = position;
    if (echo) return;

    pendingPosition = position;
    // 拖动期间只记录位置，结束后再落盘，避免写配置触发窗口回位
    if (dragging) return;
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(flushMoved, 300);
  });
}


void refreshIcons();
pushDropZones();
render();
document.body.dataset.ready = "true";
