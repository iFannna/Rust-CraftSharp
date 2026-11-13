import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HUD_ASSETS, loadImage } from "./hud/assets";
import { FileNameOverlay } from "./hud/fileNameOverlay";
import { HotbarInteraction, type HotbarHost } from "./hud/hotbarInteraction";
import { computeLayout, slotIndexAtPoint, type OffhandConfig } from "./hud/layout";
import { isPathMissing, loadSlotIcon } from "./hud/iconService";
import {
  copyItemPath,
  cutSlot,
  copySlot,
  deleteSlotContent,
  getClipboard,
  openItem,
  pasteInto,
  renameItem,
  revealItem,
  runItemAsAdmin,
  subscribeClipboard
} from "./hud/slotActions";
import { showSlotMenu, type MenuItemSpec } from "./hud/slotMenu";
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

const EXECUTABLE_EXTENSIONS = [".exe", ".bat", ".cmd", ".msi", ".ps1", ".vbs"];

const params = new URLSearchParams(location.search);
const forcedScale = Number(params.get("scale"));
const scale = Number.isFinite(forcedScale) && forcedScale > 0
  ? forcedScale
  : Math.max(1, (window.screen.width / 2560) * 6);

// 副手槽显隐暂时由 URL 参数控制，等设置面板接入后改读配置
const offhandParam = params.get("offhand") ?? "";
const offhand: OffhandConfig = {
  left: offhandParam === "both" || offhandParam === "left",
  right: offhandParam === "both" || offhandParam === "right"
};

const canvas = document.querySelector<HTMLCanvasElement>("#hud");
const fileNameElement = document.querySelector<HTMLElement>("#file-name");

if (!canvas || !fileNameElement) {
  throw new Error("HUD 元素缺失");
}

const renderer = await createStatusBarRenderer(canvas);
const overlay = new FileNameOverlay(fileNameElement, scale, "#FFFFFF");

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

const layout = () => computeLayout(scale, offhand);

function render() {
  const drag = interaction.state.drag;
  const cutIndex = cutSlotId ? hotbarIndexOfSlotId(cutSlotId) : -1;

  renderer({
    ...baseModel,
    slotIcons: icons,
    offhand,
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
  const showTargetIcon = false;

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

function isExecutable(path: string): boolean {
  const lower = path.toLowerCase();
  return EXECUTABLE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

async function buildMenuItems(globalIndex: number): Promise<MenuItemSpec[]> {
  const item = getSlotItem(globalIndex);
  const clipboardPaths = await invoke<string[]>("read_clipboard_paths").catch(() => []);
  const hasClipboard = getClipboard() !== null || clipboardPaths.length > 0;

  if (!item) {
    return [{ id: "paste", label: "粘贴", disabled: !hasClipboard }];
  }

  const items: MenuItemSpec[] = [
    { id: "open", label: "打开" },
    { id: "reveal", label: "打开文件所在位置" }
  ];

  if (isExecutable(item.path)) {
    items.push({ id: "admin", label: "以管理员身份运行" });
  }

  items.push(
    { id: "separator-1", label: "", separator: true },
    { id: "copy-path", label: "复制文件地址" },
    { id: "cut", label: "剪切" },
    { id: "copy", label: "复制" },
    { id: "paste", label: "粘贴", disabled: !hasClipboard },
    { id: "separator-2", label: "", separator: true },
    { id: "delete", label: "删除" },
    { id: "rename", label: "重命名" }
  );

  return items;
}

async function runMenuAction(action: string, globalIndex: number): Promise<void> {
  const slotId = slotIdForGlobal(globalIndex);
  const item = getSlotItem(globalIndex);

  switch (action) {
    case "open":
      if (item) await openItem(slotId, item);
      break;
    case "reveal":
      if (item) await revealItem(item);
      break;
    case "admin":
      if (item) await runItemAsAdmin(item);
      break;
    case "copy-path":
      if (item) await copyItemPath(item);
      break;
    case "cut":
      if (item) await cutSlot(slotId, item);
      break;
    case "copy":
      if (item) await copySlot(slotId, item);
      break;
    case "paste":
      await pasteInto(slotId);
      break;
    case "delete":
      deleteSlotContent(slotId);
      break;
    case "rename":
      if (item) await renameItem(item);
      break;
    default:
      break;
  }
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
      const items = await buildMenuItems(globalIndex);
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
  clickMode: () => "double",
  hoverEnabled: () => true
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
  const width = canvas.width;
  const height = canvas.height;
  const screen = window.screen as Screen & { availTop?: number };
  const x = Math.round((screen.availWidth - width) / 2);
  const y = Math.round((screen.availTop ?? 0) + screen.availHeight - height);

  await currentWindow.setSize(new LogicalSize(width, height));
  await currentWindow.setPosition(new LogicalPosition(x, y));

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
