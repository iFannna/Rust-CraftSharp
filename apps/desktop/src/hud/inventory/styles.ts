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
import type { MessageKey } from "@/i18n";

export interface SlotCoord {
  slot_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContainerStyle {
  file: string;
  nameKey: MessageKey;
  url: string;
  coords: SlotCoord[];
}

const PLAYER_SLOT_ID = "player";

// 顺序与原样式预览一致，按文件名枚举
export const CONTAINER_STYLES: ContainerStyle[] = [
  { file: "brewing_stand.png", nameKey: "inventoryStyle.brewingStand", url: brewingStandUrl, coords: brewingStandCoords },
  { file: "cartography_table.png", nameKey: "inventoryStyle.cartographyTable", url: cartographyTableUrl, coords: cartographyTableCoords },
  { file: "crafter.png", nameKey: "inventoryStyle.crafter", url: crafterUrl, coords: crafterCoords },
  { file: "crafting_table.png", nameKey: "inventoryStyle.craftingTable", url: craftingTableUrl, coords: craftingTableCoords },
  { file: "dispenser.png", nameKey: "inventoryStyle.dispenser", url: dispenserUrl, coords: dispenserCoords },
  { file: "furnace.png", nameKey: "inventoryStyle.furnace", url: furnaceUrl, coords: furnaceCoords },
  { file: "generic_54.png", nameKey: "inventoryStyle.largeChest", url: generic54Url, coords: generic54Coords },
  { file: "grindstone.png", nameKey: "inventoryStyle.grindstone", url: grindstoneUrl, coords: grindstoneCoords },
  { file: "hopper.png", nameKey: "inventoryStyle.hopper", url: hopperUrl, coords: hopperCoords },
  { file: "horse.png", nameKey: "inventoryStyle.horse", url: horseUrl, coords: horseCoords },
  { file: "inventory.png", nameKey: "inventoryStyle.inventory", url: inventoryUrl, coords: inventoryCoords },
  { file: "nautilus.png", nameKey: "inventoryStyle.nautilus", url: nautilusUrl, coords: nautilusCoords },
  { file: "shulker_box.png", nameKey: "inventoryStyle.shulkerBox", url: shulkerBoxUrl, coords: shulkerBoxCoords },
  { file: "smithing.png", nameKey: "inventoryStyle.smithing", url: smithingUrl, coords: smithingCoords },
  // 标签页物品栏没有独立坐标，与原实现一样回退到 inventory.json
  { file: "tab_inventory.png", nameKey: "inventoryStyle.tabInventory", url: tabInventoryUrl, coords: inventoryCoords }
];

export const DEFAULT_STYLE = "inventory.png";

export function findContainerStyle(file: string): ContainerStyle {
  return CONTAINER_STYLES.find((style) => style.file === file) ?? CONTAINER_STYLES.find((style) => style.file === DEFAULT_STYLE)!;
}

export function isPlayerSlot(slotId: string): boolean {
  return slotId === PLAYER_SLOT_ID;
}
