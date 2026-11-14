// 状态栏由 Rust 原生绘制，这里只负责配置、格子数据与菜单联动。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getConfig, subscribeConfig, updateConfig } from "@/config/appConfig";
import {
  clearSlot,
  displayNameOf,
  getSlotItem,
  setSlot,
  slotIdForGlobal,
  subscribeSlots,
  swapSlots
} from "@/hud/slots/store";
import { SHARED_SCOPE, getClipboard, openItem, subscribeClipboard } from "@/hud/slots/actions";
import { buildSlotMenuItems, runSlotMenuAction } from "@/hud/slots/menuActions";
import { showSlotMenuAt } from "@/hud/slots/menu";

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

function buildConfig() {
  const config = getConfig();
  const hotbar = config.hotbar;
  const elements = config.hudElements.elements;
  const clipboard = getClipboard();

  const slots: Array<{ index: number; path: string; name: string }> = [];
  for (let index = 0; index < 11; index += 1) {
    const item = getSlotItem(index);
    if (item) slots.push({ index, path: item.path, name: displayNameOf(item) });
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
    fileNameColor: hotbar.fileNameColor,
    dropKey: config.hotkeys.dropItem,
    cutSlot: clipboard?.cut ? globalIndexOf(clipboard.slotId) : -1,
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

function push() {
  void invoke("hud_apply", { config: buildConfig() }).catch(() => undefined);
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

void listen<{ index: number; path: string }>("hud-files", (event) => {
  const { index, path } = event.payload;
  setSlot(slotIdForGlobal(index), { path });
});

void listen<{ x: number; y: number; height: number }>("hud-moved", (event) => {
  const { x, y, height } = event.payload;
  updateConfig({ statusBar: { position: { x, y }, positionHeight: height } });
});

push();
document.body.dataset.ready = "true";
