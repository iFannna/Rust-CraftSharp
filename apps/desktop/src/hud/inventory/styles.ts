/** 物品栏容器样式与格子坐标，全部来自原版 jar 解压资源，不重新采样 */

import brewingStandUrl from "@assets/minecraft/textures/gui/container/brewing_stand.png";
import cartographyTableUrl from "@assets/minecraft/textures/gui/container/cartography_table.png";
import crafterUrl from "@assets/minecraft/textures/gui/container/crafter.png";
import craftingTableUrl from "@assets/minecraft/textures/gui/container/crafting_table.png";
import dispenserUrl from "@assets/minecraft/textures/gui/container/dispenser.png";
import furnaceUrl from "@assets/minecraft/textures/gui/container/furnace.png";
import generic54Url from "@assets/minecraft/textures/gui/container/generic_54.png";
import grindstoneUrl from "@assets/minecraft/textures/gui/container/grindstone.png";
import hopperUrl from "@assets/minecraft/textures/gui/container/hopper.png";
import horseUrl from "@assets/minecraft/textures/gui/container/horse.png";
import inventoryUrl from "@assets/minecraft/textures/gui/container/inventory.png";
import nautilusUrl from "@assets/minecraft/textures/gui/container/nautilus.png";
import shulkerBoxUrl from "@assets/minecraft/textures/gui/container/shulker_box.png";
import smithingUrl from "@assets/minecraft/textures/gui/container/smithing.png";
import tabInventoryUrl from "@assets/minecraft/textures/gui/container/tab_inventory.png";

import brewingStandCoords from "@assets/minecraft/textures/gui/container/coordinate/brewing_stand.json";
import cartographyTableCoords from "@assets/minecraft/textures/gui/container/coordinate/cartography_table.json";
import crafterCoords from "@assets/minecraft/textures/gui/container/coordinate/crafter.json";
import craftingTableCoords from "@assets/minecraft/textures/gui/container/coordinate/crafting_table.json";
import dispenserCoords from "@assets/minecraft/textures/gui/container/coordinate/dispenser.json";
import furnaceCoords from "@assets/minecraft/textures/gui/container/coordinate/furnace.json";
import generic54Coords from "@assets/minecraft/textures/gui/container/coordinate/generic_54.json";
import grindstoneCoords from "@assets/minecraft/textures/gui/container/coordinate/grindstone.json";
import hopperCoords from "@assets/minecraft/textures/gui/container/coordinate/hopper.json";
import horseCoords from "@assets/minecraft/textures/gui/container/coordinate/horse.json";
import inventoryCoords from "@assets/minecraft/textures/gui/container/coordinate/inventory.json";
import nautilusCoords from "@assets/minecraft/textures/gui/container/coordinate/nautilus.json";
import shulkerBoxCoords from "@assets/minecraft/textures/gui/container/coordinate/shulker_box.json";
import smithingCoords from "@assets/minecraft/textures/gui/container/coordinate/smithing.json";

export interface SlotCoord {
  slot_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContainerStyle {
  file: string;
  name: string;
  url: string;
  coords: SlotCoord[];
}

const PLAYER_SLOT_ID = "player";

// 顺序与原样式预览一致，按文件名枚举
export const CONTAINER_STYLES: ContainerStyle[] = [
  { file: "brewing_stand.png", name: "酿造台", url: brewingStandUrl, coords: brewingStandCoords },
  { file: "cartography_table.png", name: "制图台", url: cartographyTableUrl, coords: cartographyTableCoords },
  { file: "crafter.png", name: "合成器", url: crafterUrl, coords: crafterCoords },
  { file: "crafting_table.png", name: "工作台", url: craftingTableUrl, coords: craftingTableCoords },
  { file: "dispenser.png", name: "发射器", url: dispenserUrl, coords: dispenserCoords },
  { file: "furnace.png", name: "熔炉", url: furnaceUrl, coords: furnaceCoords },
  { file: "generic_54.png", name: "大箱子", url: generic54Url, coords: generic54Coords },
  { file: "grindstone.png", name: "砂轮", url: grindstoneUrl, coords: grindstoneCoords },
  { file: "hopper.png", name: "漏斗", url: hopperUrl, coords: hopperCoords },
  { file: "horse.png", name: "马", url: horseUrl, coords: horseCoords },
  { file: "inventory.png", name: "物品栏", url: inventoryUrl, coords: inventoryCoords },
  { file: "nautilus.png", name: "鹦鹉螺", url: nautilusUrl, coords: nautilusCoords },
  { file: "shulker_box.png", name: "潜影盒", url: shulkerBoxUrl, coords: shulkerBoxCoords },
  { file: "smithing.png", name: "锻造台", url: smithingUrl, coords: smithingCoords },
  // 标签页物品栏没有独立坐标，与原实现一样回退到 inventory.json
  { file: "tab_inventory.png", name: "标签页物品栏", url: tabInventoryUrl, coords: inventoryCoords }
];

export const DEFAULT_STYLE = "inventory.png";

export function findContainerStyle(file: string): ContainerStyle {
  return CONTAINER_STYLES.find((style) => style.file === file) ?? CONTAINER_STYLES.find((style) => style.file === DEFAULT_STYLE)!;
}

export function isPlayerSlot(slotId: string): boolean {
  return slotId === PLAYER_SLOT_ID;
}
