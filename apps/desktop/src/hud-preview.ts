import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HUD_ASSETS, loadImage } from "./hud/assets";
import { FileNameOverlay } from "./hud/fileNameOverlay";
import { HotbarInteraction, type HotbarHost } from "./hud/hotbarInteraction";
import { computeLayout, slotIndexAtPoint, type OffhandConfig } from "./hud/layout";
import { isPathMissing, loadSlotIcon } from "./hud/iconService";
import { SHARED_SCOPE, getClipboard, openItem, subscribeClipboard } from "./hud/slotActions";
import { buildSlotMenuItems, runSlotMenuAction } from "./hud/slotMenuActions";
import { showSlotMenu } from "./hud/slotMenu";
import {
  clearSlot,
  displayNameOf,
  getSlotItem,
  setSlot,
  slotIdForGlobal,
  subscribeSlots,
  swapSlots
} from "./hud/slotStore";
import { createStatusBarRenderer, type SlotIcon, type StatusBarModel } from "./hud/statusbar";
import { getConfig, subscribeConfig, updateConfig } from "./config/appConfig";

const params = new URLSearchParams(location.search);
const forcedScale = Number(params.get("scale"));
const scale = Number.isFinite(forcedScale) && forcedScale > 0
  ? forcedScale
  : Math.max(1, (window.screen.width / 2560) * 6);

// URL 参数只用于单独预览某个副手场景，正式显隐读设置
const offhandParam = params.get("offhand");
let hotbarConfig = getConfig().hotbar;

function currentOffhand(): OffhandConfig {
  if (offhandParam !== null) {
    return {
      left: offhandParam === "both" || offhandParam === "left",
      right: offhandParam === "both" || offhandParam === "right"
    };
  }
  return { left: hotbarConfig.leftOffhand, right: hotbarConfig.rightOffhand };
}

const canvas = document.querySelector<HTMLCanvasElement>("#hud");
const fileNameElement = document.querySelector<HTMLElement>("#file-name");

if (!canvas || !fileNameElement) {
  throw new Error("HUD 元素缺失");
}

const renderer = await createStatusBarRenderer(canvas);
const overlay = new FileNameOverlay(fileNameElement, scale, hotbarConfig.fileNameColor);

const baseModel: StatusBarModel = {
  scale,
  health: 20,
  maxHealth: 20,
  food: 20,
  maxFood: 20,
  air: 20,
  maxAir: 20,
  armor: 20,
  maxArmor: 20,
  absorption: 20,
  maxAbsorption: 20,
  exp: 50,
  selectedSlot: -1
};

let icons: Array<SlotIcon | null> = Array(11).fill(null);
let cutSlotId: string | null = null;
let iconGeneration = 0;

const layout = () => computeLayout(scale, currentOffhand());

function render() {
  const drag = interaction.state.drag;
  const cutIndex = cutSlotId ? hotbarIndexOfSlotId(cutSlotId) : -1;

  renderer({
    ...baseModel,
    slotIcons: icons,
    offhand: currentOffhand(),
    selectedSlot: interaction.state.selected,
    hoverSlot: interaction.state.hover,
    dimmedSlot: cutIndex >= 0 ? cutIndex + 2 : undefined,
    drag: drag && drag.icon ? { icon: drag.icon, x: drag.x, y: drag.y } : null,
    dragSourceSlot: drag?.source
  });
}

function hotbarIndexOfSlotId(slotId: string): number {
  const match = /^hotbar_(\d+)$/.exec(slotId);
  return match ? Number(match[1]) : -1;
}

async function refreshIcons() {
  const generation = ++iconGeneration;
  const showTargetIcon = hotbarConfig.showTargetIcon;

  const next = await Promise.all(
    Array.from({ length: 11 }, (_, globalIndex) => {
      const item = getSlotItem(globalIndex);
      return item ? loadSlotIcon({ path: item.path, showTargetIcon }) : Promise.resolve(null);
    })
  );

  if (generation !== iconGeneration) return;
  icons = next;
  render();
}

async function runMenuAction(action: string, globalIndex: number): Promise<void> {
  await runSlotMenuAction(action, slotIdForGlobal(globalIndex), getSlotItem(globalIndex), SHARED_SCOPE);
}

const host: HotbarHost = {
  layout,
  getItem: (globalIndex) => getSlotItem(globalIndex),
  getIcon: (globalIndex) => icons[globalIndex] ?? null,
  requestRender: render,
  openSlot: (globalIndex) => {
    const item = getSlotItem(globalIndex);
    if (item) void openItem(slotIdForGlobal(globalIndex), item);
  },
  dropSlot: (globalIndex) => clearSlot(slotIdForGlobal(globalIndex)),
  swapSlots: (source, target) => swapSlots(slotIdForGlobal(source), slotIdForGlobal(target)),
  openMenu: (globalIndex, clientX, clientY) => {
    void (async () => {
      const items = await buildSlotMenuItems(getSlotItem(globalIndex), SHARED_SCOPE);
      const action = await showSlotMenu(items, clientX, clientY);
      if (action) await runMenuAction(action, globalIndex);
    })();
  },
  showFileName: (item) => {
    if (!item || isPathMissing(item.path)) {
      overlay.hideImmediately();
      return;
    }
    overlay.show(displayNameOf(item));
  },
  clickMode: () => hotbarConfig.clickMode,
  hoverEnabled: () => hotbarConfig.hoverEffect
};

const interaction = new HotbarInteraction(canvas, host);
interaction.attach();

subscribeSlots(() => {
  void refreshIcons();
});

subscribeClipboard(() => {
  const clipboard = getClipboard();
  cutSlotId = clipboard && clipboard.cut ? clipboard.slotId : null;
  render();
});

void refreshIcons();
render();
document.body.dataset.ready = "true";

const tauriWindow = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

if (tauriWindow) {
  const currentWindow = getCurrentWindow();

  const applyWindowGeometry = async () => {
    const current = layout();
    await currentWindow.setSize(new LogicalSize(Math.ceil(current.width), Math.ceil(current.height)));

    const saved = getConfig().statusBar.position;
    if (saved) {
      await currentWindow.setPosition(new LogicalPosition(saved.x, saved.y));
      return;
    }

    const screen = window.screen as Screen & { availTop?: number };
    const x = Math.round((screen.availWidth - current.width) / 2);
    const y = Math.round((screen.availTop ?? 0) + screen.availHeight - current.height);
    await currentWindow.setPosition(new LogicalPosition(x, y));
  };

  await applyWindowGeometry();

  // 未锁定时按住空白区域拖动状态栏
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || getConfig().statusBar.locked) return;
    const rect = canvas.getBoundingClientRect();
    if (slotIndexAtPoint(layout(), event.clientX - rect.left, event.clientY - rect.top) >= 0) return;
    void currentWindow.startDragging();
  });

  await currentWindow.onMoved(({ payload }) => {
    void (async () => {
      const factor = await currentWindow.scaleFactor();
      const point = payload as { x: number; y: number };
      updateConfig({ statusBar: { position: { x: Math.round(point.x / factor), y: Math.round(point.y / factor) } } });
    })();
  });

  subscribeConfig(() => {
    hotbarConfig = getConfig().hotbar;
    overlay.setColorSetting(hotbarConfig.fileNameColor);
    void applyWindowGeometry();
    void refreshIcons();
  });

  await currentWindow.onDragDropEvent((event) => {
    if (event.payload.type !== "drop") return;

    const ratio = window.devicePixelRatio || 1;
    const dropX = event.payload.position.x / ratio;
    const dropY = event.payload.position.y / ratio;
    const index = slotIndexAtPoint(layout(), dropX, dropY);
    const path = event.payload.paths[0];

    if (index >= 0 && path) {
      setSlot(slotIdForGlobal(index), { path });
    }
  });
} else {
  // 浏览器预览时给几个示例图标，便于检查渲染
  const [heart, food, barrier] = await Promise.all([
    loadImage(HUD_ASSETS.heartFull),
    loadImage(HUD_ASSETS.foodFull),
    loadImage(HUD_ASSETS.barrier)
  ]);
  icons = [heart, food, barrier].map((image) => ({ image, smooth: true })).concat(Array(8).fill(null));
  render();
}
