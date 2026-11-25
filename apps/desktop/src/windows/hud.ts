// 常驻控制页：状态栏与物品栏由 Rust 原生绘制，这里负责配置、格子数据、
// 托盘手势与启动恢复。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getConfig, subscribeConfig, updateConfig, type BossBarConfig } from "@/config/appConfig";
import {
  clearSlot,
  displayNameOf,
  getSlotFor,
  getSlotItem,
  slotIdForGlobal,
  subscribeSlots,
  swapSlots
} from "@/hud/slots/store";
import { SHARED_SCOPE, getClipboard, openItem, sameSlotScope, subscribeClipboard } from "@/hud/slots/actions";
import { buildSlotMenuItems, runSlotMenuAction } from "@/hud/slots/menuActions";
import { showSlotMenuAt } from "@/hud/slots/menu";
import { initializeHotkeys } from "@/lib/hotkeys";
import { installProductionGuards } from "@/lib/productionGuards";
import { initializeTray } from "@/lib/tray";
import { reapplyStaticWallpaper } from "@/lib/wallpaperRestore";
import { applyConfiguredVisibility, ensureEntityOverlay, setSettingsVisible, toggleInventory } from "@/lib/windowControls";

const params = new URLSearchParams(location.search);
const forcedScale = Number(params.get("scale"));

function globalIndexOf(slotId: string): number {
  if (slotId === "hotbar_left_offhand") return 0;
  if (slotId === "hotbar_right_offhand") return 1;
  const match = /^hotbar_(\d+)$/.exec(slotId);
  return match ? Number(match[1]) + 2 : -1;
}

function elementOf(element: ReturnType<typeof getConfig>["hudElements"]["elements"]["health"]) {
  return {
    visible: element.visible,
    style: element.iconStyle,
    value: element.currentValue,
    max: element.maxValue,
    regen: element.regenAnimation,
    saturation: element.saturationValue,
    custom: element.customValueEnabled,
    mapping: element.dataMappingType
  };
}

/** 文件名标签不带后缀，点开头的隐藏文件保持原样 */
function labelName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function buildConfig() {
  const config = getConfig();
  const hotbar = config.hotbar;
  const elements = config.hudElements.elements;
  const clipboard = getClipboard();

  const slots: Array<{ index: number; path: string; name: string }> = [];
  for (let index = 0; index < 11; index += 1) {
    const item = getSlotItem(index);
    if (item) slots.push({ index, path: item.path, name: labelName(displayNameOf(item)) });
  }

  const scale =
    Number.isFinite(forcedScale) && forcedScale > 0
      ? forcedScale
      : Math.max(1, (window.screen.width / 2560) * 6);

  return {
    scale,
    leftOffhand: hotbar.leftOffhand,
    rightOffhand: hotbar.rightOffhand,
    hotbarVisible: hotbar.visible,
    showTargetIcon: hotbar.showTargetIcon,
    clickMode: hotbar.clickMode,
    hoverEffect: hotbar.hoverEffect,
    locked: config.statusBar.locked,
    visible: config.statusBar.visible,
    rememberPosition: config.statusBar.rememberPosition,
    position: config.statusBar.position ?? null,
    positionHeight: config.statusBar.positionHeight ?? null,
    showFileName: hotbar.showFileName,
    fileNameColor: hotbar.fileNameColor,
    dropKey: config.hotkeys.dropItem,
    openInventory: config.hotkeys.openInventory,
    cutSlot: clipboard?.cut && sameSlotScope(clipboard.scope, SHARED_SCOPE) ? globalIndexOf(clipboard.slotId) : -1,
    elements: {
      health: elementOf(elements.health),
      food: elementOf(elements.food),
      air: elementOf(elements.air),
      armor: elementOf(elements.armor),
      absorbing: elementOf(elements.absorbing),
      expBar: elementOf(elements.expBar)
    },
    slots
  };
}

function crosshairConfig() {
  const hud = getConfig().hudElements;
  return {
    visible: hud.crosshairVisible,
    crosshairVisible: hud.crosshairVisible,
    topMost: hud.crosshairTopMost,
    attackVisible: hud.attackIndicatorVisible,
    attackDataMapping: hud.attackIndicator.dataMappingEnabled,
    attackMapping: hud.attackIndicator.dataMappingType,
    attackCustom: hud.attackIndicator.customValueEnabled,
    attackValue: hud.attackIndicator.currentValue
  };
}

function bossBarList(bars: BossBarConfig[]) {
  return bars.map((bar) => ({
    id: bar.id,
    name: bar.name,
    color: bar.color,
    notch: bar.notch,
    enabled: bar.enabled,
    dataMapping: bar.dataMappingEnabled,
    mapping: bar.dataMappingType,
    custom: bar.customValueEnabled,
    value: bar.currentValue
  }));
}

function inventoryConfig() {
  const config = getConfig();
  const inventory = config.inventory;
  const clipboard = getClipboard();
  return {
    visible: inventory.visible,
    locked: inventory.locked,
    rememberPosition: inventory.rememberPosition,
    position: inventory.position ?? null,
    grayOverlay: inventory.grayOverlay,
    grayOverlayOpacity: inventory.grayOverlayOpacity,
    hideStatusBar: inventory.hideStatusBar,
    clickMode: inventory.clickMode,
    style: inventory.style,
    sharedData: inventory.sharedData,
    hoverEffect: inventory.hoverEffect,
    showModel: inventory.showModel,
    showTooltip: inventory.showTooltip,
    tooltipShowFileName: inventory.tooltipShowFileName,
    tooltipShowOriginalName: inventory.tooltipShowOriginalName,
    tooltipShowFilePath: inventory.tooltipShowFilePath,
    tooltipShowFileType: inventory.tooltipShowFileType,
    fileNameColor: inventory.fileNameColor,
    cutSlot: clipboard?.cut && sameSlotScope(clipboard.scope, { style: inventory.style, shared: inventory.sharedData })
      ? clipboard.slotId
      : null,
    player: {
      skinName: config.player.skinName,
      skinType: config.player.skinType,
      skinPath: config.player.skinPath
    },
    dropKey: config.hotkeys.dropItem,
    openInventory: config.hotkeys.openInventory
  };
}

function push() {
  // 启动恢复时 Rust 先于本页显示物品栏，预热事件会丢；配置就绪后补建覆盖层
  if (getConfig().inventory.visible && getConfig().inventory.showModel) {
    void ensureEntityOverlay().catch(() => undefined);
  }
  void invoke("hud_apply", { config: buildConfig() }).catch(() => undefined);
  void invoke("inventory_apply", { config: inventoryConfig() }).catch(() => undefined);
  void invoke("crosshair_apply", { config: crosshairConfig() }).catch(() => undefined);
  void invoke("bossbar_apply", { bars: bossBarList(getConfig().bossBars) }).catch(() => undefined);
  cacheForStartup();
}

let cacheTimer = 0;

/** 把同一份参数镜像到磁盘，下次启动原生窗口可以直接先画，不必等本页就绪 */
function cacheForStartup() {
  window.clearTimeout(cacheTimer);
  cacheTimer = window.setTimeout(() => {
    const payload = JSON.stringify({
      hud: buildConfig(),
      inventory: inventoryConfig(),
      crosshair: crosshairConfig(),
      bossBars: bossBarList(getConfig().bossBars)
    });
    void invoke("hud_cache_write", { payload }).catch(() => undefined);
  }, 250);
}

subscribeConfig(push);
subscribeSlots(push);
subscribeClipboard(push);

void listen<number>("hud-open", async (event) => {
  const index = event.payload;
  const item = getSlotItem(index);
  if (item) await openItem(slotIdForGlobal(index), item);
});

void listen<number>("hud-drop", (event) => {
  clearSlot(slotIdForGlobal(event.payload));
});

void listen<{ source: number; target: number }>("hud-swap", (event) => {
  const { source, target } = event.payload;
  swapSlots(slotIdForGlobal(source), slotIdForGlobal(target));
});

void listen<{ index: number; x: number; y: number }>("hud-menu", (event) => {
  const { index, x, y } = event.payload;
  void (async () => {
    const items = await buildSlotMenuItems(getSlotItem(index), SHARED_SCOPE);
    const action = await showSlotMenuAt(items, x, y);
    if (action) await runSlotMenuAction(action, slotIdForGlobal(index), getSlotItem(index), SHARED_SCOPE);
  })();
});

void listen<{ slotId: string; x: number; y: number }>("inventory-menu", (event) => {
  const { slotId, x, y } = event.payload;
  const inventory = getConfig().inventory;
  const scope = { style: inventory.style, shared: inventory.sharedData };
  const item = getSlotFor(slotId, scope.style, scope.shared);
  void (async () => {
    const items = await buildSlotMenuItems(item, scope);
    const action = await showSlotMenuAt(items, x, y);
    if (action) await runSlotMenuAction(action, slotId, item, scope);
  })();
});

void listen<string>("inventory-open", (event) => {
  const inventory = getConfig().inventory;
  const scope = { style: inventory.style, shared: inventory.sharedData };
  const slotId = event.payload;
  const item = getSlotFor(slotId, scope.style, scope.shared);
  if (item) void openItem(slotId, item, scope);
});

void listen<{ x: number; y: number }>("inventory-moved", (event) => {
  const { x, y } = event.payload;
  updateConfig({ inventory: { position: { x, y } } });
});

void listen<boolean>("inventory-visibility", (event) => {
  updateConfig({ inventory: { visible: event.payload } });
});

void listen("hud-open-inventory", () => {
  void toggleInventory();
});

void listen<{ x: number; y: number; height: number }>("hud-moved", (event) => {
  const { x, y, height } = event.payload;
  updateConfig({ statusBar: { position: { x, y }, positionHeight: height } });
});

void listen("entity-view-warm", () => {
  void ensureEntityOverlay();
});

void invoke("slots_register_scope", { label: "hud", style: "inventory.png", shared: true }).catch(() => undefined);

push();
document.body.dataset.ready = "true";

initializeHotkeys();
installProductionGuards();
initializeTray();

void (async () => {
  await applyConfiguredVisibility().catch(() => undefined);
  if (getConfig().system.defaultOpenSettings) {
    await setSettingsVisible(true).catch(() => undefined);
  }
  // 动态壁纸由原生侧恢复；静态壁纸跟随当前存储路径重设
  await reapplyStaticWallpaper().catch(() => undefined);
})();
