/** 物品栏容器样式清单：贴图与格子坐标由 Rust 原生侧维护，这里只提供设置项 */

import type { MessageKey } from "@/i18n";

export interface ContainerStyleOption {
  file: string;
  nameKey: MessageKey;
}

export const CONTAINER_STYLES: ContainerStyleOption[] = [
  { file: "brewing_stand.png", nameKey: "inventoryStyle.brewingStand" },
  { file: "cartography_table.png", nameKey: "inventoryStyle.cartographyTable" },
  { file: "crafter.png", nameKey: "inventoryStyle.crafter" },
  { file: "crafting_table.png", nameKey: "inventoryStyle.craftingTable" },
  { file: "dispenser.png", nameKey: "inventoryStyle.dispenser" },
  { file: "furnace.png", nameKey: "inventoryStyle.furnace" },
  { file: "generic_54.png", nameKey: "inventoryStyle.largeChest" },
  { file: "grindstone.png", nameKey: "inventoryStyle.grindstone" },
  { file: "hopper.png", nameKey: "inventoryStyle.hopper" },
  { file: "horse.png", nameKey: "inventoryStyle.horse" },
  { file: "inventory.png", nameKey: "inventoryStyle.inventory" },
  { file: "nautilus.png", nameKey: "inventoryStyle.nautilus" },
  { file: "shulker_box.png", nameKey: "inventoryStyle.shulkerBox" },
  { file: "smithing.png", nameKey: "inventoryStyle.smithing" },
  { file: "tab_inventory.png", nameKey: "inventoryStyle.tabInventory" }
];
