import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HUD_ASSETS, loadImage } from "@/hud/statusbar/assets";
import { FileNameOverlay } from "@/hud/statusbar/fileName";
import { HotbarInteraction, type HotbarHost } from "@/hud/statusbar/interaction";
import {
  computeLayout,
  slotIndexAtPoint,
  type OffhandConfig,
  type StatusBarVisibility
} from "@/hud/statusbar/layout";
import { isPathMissing, loadSlotIcon } from "@/hud/statusbar/iconService";
import { SHARED_SCOPE, getClipboard, openItem, subscribeClipboard } from "@/hud/slots/actions";
import { buildSlotMenuItems, runSlotMenuAction } from "@/hud/slots/menuActions";
import { showSlotMenu } from "@/hud/slots/menu";
import {
  clearSlot,
  displayNameOf,
  getSlotItem,
  setSlot,
  slotIdForGlobal,
  subscribeSlots,
  swapSlots
} from "@/hud/slots/store";
import {
  createStatusBarRenderer,
  type SlotIcon,
  type StatusBarModel,
  type StyledImages,
  type StyledRowImages
} from "@/hud/statusbar/renderer";
import { expStyleUrls, rowStyleUrls, type RowStyleUrls } from "@/hud/statusbar/iconStyles";
import {
  getConfig,
  subscribeConfig,
  updateConfig,
  type HudElementConfig,
  type HudElementId
} from "@/config/appConfig";
import { clampToWorkArea } from "@/hud/shared/windowPlacement";
import { startWindowDrag } from "@/hud/shared/windowDrag";
import { createHitMask } from "@/lib/hitMask";

const params = new URLSearchParams(location.search);
const forcedScale = Number(params.get("scale"));
const scale = Number.isFinite(forcedScale) && forcedScale > 0
  ? forcedScale
  : Math.max(1, (window.screen.width / 2560) * 6);

// URL 参数只用于单独预览某个副手场景，正式显隐读设置
const offhandParam = params.get("offhand");
let hotbarConfig = getConfig().hotbar;
let hudConfig = getConfig().hudElements;
let metrics: Record<"battery" | "memory" | "cpu" | "gpu", number> = { battery: 1, memory: 0, cpu: 0, gpu: 0 };

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
let refreshHitMask: ((full?: boolean) => void) | null = null;

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
  exp: 100,
  selectedSlot: -1
};

let icons: Array<SlotIcon | null> = Array(11).fill(null);
let cutSlotId: string | null = null;
let iconGeneration = 0;

function visibility(): StatusBarVisibility {
  const elements = hudConfig.elements;
  return {
    health: elements.health.visible,
    food: elements.food.visible,
    air: elements.air.visible,
    armor: elements.armor.visible,
    absorbing: elements.absorbing.visible,
    expBar: elements.expBar.visible,
    hotbar: hotbarConfig.visible
  };
}

/** 自定义值优先，否则一律走数据映射，与原版判定顺序一致 */
function elementValue(element: HudElementConfig, max: number): number {
  if (element.customValueEnabled) return element.currentValue;
  return Math.round((metrics[element.dataMappingType] ?? 0) * max);
}

function modelValues() {
  const elements = hudConfig.elements as Record<HudElementId, HudElementConfig>;
  return {
    health: elementValue(elements.health, elements.health.maxValue),
    maxHealth: elements.health.maxValue,
    food: elementValue(elements.food, elements.food.maxValue),
    maxFood: elements.food.maxValue,
    air: elementValue(elements.air, elements.air.maxValue),
    maxAir: elements.air.maxValue,
    armor: elementValue(elements.armor, elements.armor.maxValue),
    maxArmor: elements.armor.maxValue,
    absorption: elementValue(elements.absorbing, elements.absorbing.maxValue),
    maxAbsorption: elements.absorbing.maxValue,
    exp: elementValue(elements.expBar, Math.min(100, elements.expBar.maxValue))
  };
}

/** 状态栏补间状态：生命值闪烁两次，空气值破裂 200ms */
let heartFlash: { previous: number } | null = null;
let airBurst: { from: number; to: number } | null = null;
let heartTimers: number[] = [];
let airTimer = 0;
let previousHealth = -1;
let previousAir = -1;

function clearHeartFlash() {
  for (const timer of heartTimers) window.clearTimeout(timer);
  heartTimers = [];
  heartFlash = null;
}

function startHeartFlash(previous: number) {
  clearHeartFlash();
  heartFlash = { previous };
  const flash = { previous };
  heartTimers = [
    window.setTimeout(() => {
      heartFlash = null;
      render();
    }, 200),
    window.setTimeout(() => {
      heartFlash = flash;
      render();
    }, 300),
    window.setTimeout(() => {
      heartFlash = null;
      heartTimers = [];
      render();
    }, 500)
  ];
}

function startAirBurst(from: number, to: number) {
  if (airTimer) window.clearTimeout(airTimer);
  airBurst = { from, to };
  airTimer = window.setTimeout(() => {
    airBurst = null;
    airTimer = 0;
    render();
  }, 200);
}

/** 数值变化时触发动画，规则与原版一致：需开启动画效果，且没有使用自定义数值 */
function animate(values: ReturnType<typeof modelValues>) {
  const elements = hudConfig.elements as Record<HudElementId, HudElementConfig>;

  if (
    previousHealth >= 0 &&
    values.health !== previousHealth &&
    elements.health.regenAnimation &&
    !elements.health.customValueEnabled
  ) {
    const before = previousHealth;
    previousHealth = values.health;
    startHeartFlash(before);
  } else {
    previousHealth = values.health;
  }

  if (
    previousAir >= 0 &&
    values.air < previousAir &&
    elements.air.regenAnimation &&
    !elements.air.customValueEnabled
  ) {
    startAirBurst(Math.floor(values.air / 2), Math.floor(previousAir / 2));
  }
  previousAir = values.air;
}

const layout = () => computeLayout(scale, currentOffhand(), visibility(), hudConfig.elements.absorbing.maxValue);

let styledImages: StyledImages | null = null;
let styledKey = "";

async function loadRow(urls: RowStyleUrls): Promise<StyledRowImages> {
  const [background, full, half, backgroundFlash, fullFlash, halfFlash] = await Promise.all([
    loadImage(urls.background),
    loadImage(urls.full),
    loadImage(urls.half),
    loadImage(urls.backgroundFlash),
    loadImage(urls.fullFlash),
    loadImage(urls.halfFlash)
  ]);
  return { background, full, half, flash: { background: backgroundFlash, full: fullFlash, half: halfFlash } };
}

async function refreshStyles() {
  const elements = hudConfig.elements;
  const key = [elements.health.iconStyle, elements.food.iconStyle, elements.absorbing.iconStyle, elements.expBar.iconStyle].join("|");
  if (key === styledKey) return;
  styledKey = key;

  try {
    const [health, food, absorbing, exp] = await Promise.all([
      loadRow(rowStyleUrls("health", elements.health.iconStyle)),
      loadRow(rowStyleUrls("food", elements.food.iconStyle)),
      loadRow(rowStyleUrls("absorbing", elements.absorbing.iconStyle)),
      (async () => {
        const urls = expStyleUrls(elements.expBar.iconStyle);
        const [background, progress] = await Promise.all([loadImage(urls.background), loadImage(urls.progress)]);
        return { background, progress };
      })()
    ]);
    if (key !== styledKey) return;
    styledImages = { health, food, absorbing, exp };
    render();
  } catch {
    // 资源缺失时保留默认图标
  }
}

function render() {
  const drag = interaction.state.drag;
  const cutIndex = cutSlotId ? hotbarIndexOfSlotId(cutSlotId) : -1;
  const values = modelValues();
  animate(values);
  const food = hudConfig.elements.food;

  renderer({
    ...baseModel,
    ...values,
    saturation: Math.max(0, Math.min(food.saturationValue, food.maxValue)),
    heartFlash,
    airBurst,
    visible: visibility(),
    styled: styledImages,
    slotIcons: icons,
    offhand: currentOffhand(),
    selectedSlot: interaction.state.selected,
    hoverSlot: interaction.state.hover,
    dimmedSlot: cutIndex >= 0 ? cutIndex + 2 : undefined,
    drag: drag && drag.icon ? { icon: drag.icon, x: drag.x, y: drag.y } : null,
    dragSourceSlot: drag?.source
  });
  // 拖动时恢复整窗区域，避免拖拽图标被窗口形状裁掉
  refreshHitMask?.(Boolean(drag));
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
  hoverEnabled: () => hotbarConfig.hoverEffect,
  dropKey: () => getConfig().hotkeys.dropItem
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
  const fileNameRects = () => {
    if (!fileNameElement.textContent || getComputedStyle(fileNameElement).visibility === "hidden") return [];
    const range = document.createRange();
    range.selectNodeContents(fileNameElement);
    const rect = range.getBoundingClientRect();
    return rect.width > 0 ? [{ x: rect.left, y: rect.top, w: rect.width, h: rect.height }] : [];
  };
  refreshHitMask = createHitMask(canvas, currentWindow.label, fileNameRects);
  refreshHitMask();
  let scaleFactor = await currentWindow.scaleFactor();
  await currentWindow.onScaleChanged(({ payload }) => {
    scaleFactor = payload.scaleFactor;
  });

  let appliedSize: { width: number; height: number } | null = null;
  let appliedPosition: { x: number; y: number } | null = null;
  let pendingPosition: { x: number; y: number } | null = null;
  let persistTimer = 0;
  let dragging = false;

  const sameSpot = (a: { x: number; y: number } | null, b: { x: number; y: number }) =>
    a !== null && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;

  const defaultPosition = () => {
    const current = layout();
    const screen = window.screen as Screen & { availTop?: number };
    return {
      x: Math.round((screen.availWidth - current.width) / 2),
      y: Math.round((screen.availTop ?? 0) + screen.availHeight - current.height)
    };
  };

  const applySize = async () => {
    const current = layout();
    const width = Math.max(1, Math.ceil(current.width));
    const height = Math.max(1, Math.ceil(current.height));
    if (appliedSize && appliedSize.width === width && appliedSize.height === height) return;
    await currentWindow.setSize(new LogicalSize(width, height));
    appliedSize = { width, height };
  };

  // 自身 setPosition 也会触发 moved，命中同一点时不再回设，避免来回拉扯
  const moveTo = async (target: { x: number; y: number }) => {
    if (sameSpot(appliedPosition, target)) return;
    await currentWindow.setPosition(new LogicalPosition(target.x, target.y));
    appliedPosition = { x: target.x, y: target.y };
  };

  const applyConfiguredPosition = async () => {
    const statusConfig = getConfig().statusBar;
    const saved = statusConfig.rememberPosition ? statusConfig.position : null;
    const current = layout();
    const target = saved ? clampToWorkArea(saved, current.width, current.height) : null;
    await moveTo(target ?? defaultPosition());
  };

  const flushMoved = () => {
    if (dragging) return;
    if (!pendingPosition || !getConfig().statusBar.rememberPosition) return;
    const position = pendingPosition;
    pendingPosition = null;
    updateConfig({ statusBar: { position } });
  };

  await applySize();
  await applyConfiguredPosition();

  // 未锁定时按住空白区域拖动状态栏；自绘拖动避免无边框窗口的原生偏移
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || getConfig().statusBar.locked) return;
    const rect = canvas.getBoundingClientRect();
    if (slotIndexAtPoint(layout(), event.clientX - rect.left, event.clientY - rect.top) >= 0) return;
    event.preventDefault();
    refreshHitMask?.(true);
    dragging = true;
    void startWindowDrag().then((position) => {
      dragging = false;
      if (!position) {
        refreshHitMask?.();
        return;
      }
      appliedPosition = position;
      pendingPosition = position;
      flushMoved();
      refreshHitMask?.();
    });
  });

  // 拖拽期间只记录位置，停下后再落盘，避免写配置触发窗口回位
  await currentWindow.onMoved(({ payload }) => {
    if (!getConfig().statusBar.rememberPosition) return;
    const point = payload as { x: number; y: number };
    const position = {
      x: Math.round(point.x / scaleFactor),
      y: Math.round(point.y / scaleFactor)
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

  let previousHotbar = getConfig().hotbar;
  let previousHud = getConfig().hudElements;

  const hasMapping = () =>
    Object.values(hudConfig.elements).some((element) => !element.customValueEnabled);

  const refreshMetrics = async () => {
    if (!hasMapping()) return;
    metrics = await invoke<typeof metrics>("system_metrics").catch(() => metrics);
    render();
  };

  const offhandOf = (hotbar: typeof hotbarConfig): OffhandConfig =>
    offhandParam !== null
      ? { left: offhandParam === "both" || offhandParam === "left", right: offhandParam === "both" || offhandParam === "right" }
      : { left: hotbar.leftOffhand, right: hotbar.rightOffhand };

  const heightOf = (hud: typeof hudConfig, hotbar: typeof hotbarConfig) =>
    computeLayout(scale, offhandOf(hotbar), {
      health: hud.elements.health.visible,
      food: hud.elements.food.visible,
      air: hud.elements.air.visible,
      armor: hud.elements.armor.visible,
      absorbing: hud.elements.absorbing.visible,
      expBar: hud.elements.expBar.visible,
      hotbar: hotbar.visible
    }, hud.elements.absorbing.maxValue).height;

  subscribeConfig(() => {
    const nextHotbar = getConfig().hotbar;
    const nextHud = getConfig().hudElements;
    const offhandChanged =
      nextHotbar.leftOffhand !== previousHotbar.leftOffhand ||
      nextHotbar.rightOffhand !== previousHotbar.rightOffhand;
    const iconsChanged = nextHotbar.showTargetIcon !== previousHotbar.showTargetIcon;
    const sizeChanged = heightOf(nextHud, nextHotbar) !== heightOf(previousHud, previousHotbar);
    const elementsChanged = JSON.stringify(nextHud.elements) !== JSON.stringify(previousHud.elements);
    previousHotbar = nextHotbar;
    previousHud = nextHud;
    hotbarConfig = nextHotbar;
    hudConfig = nextHud;
    overlay.setColorSetting(nextHotbar.fileNameColor);

    if (offhandChanged || sizeChanged) {
      void applySize().then(applyConfiguredPosition);
    } else {
      void applyConfiguredPosition();
    }
    render();
    if (iconsChanged) void refreshIcons();
    if (elementsChanged) {
      void refreshMetrics();
      void refreshStyles();
    }
  });

  window.setInterval(() => {
    void refreshMetrics();
  }, 1000);

  void refreshMetrics();
  void refreshStyles();

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
