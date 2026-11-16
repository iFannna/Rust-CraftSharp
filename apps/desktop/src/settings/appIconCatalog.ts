/** 图标选择器目录：只读贴图清单，贴图按稳定路径按需加载 */

import blockCategories from "@assets/minecraft/textures/block/data/categories.json";
import itemCategories from "@assets/minecraft/textures/item/data/categories.json";
import type { MessageKey } from "@/i18n";

export interface AppIconEntry {
  id: string;
  file: string;
}

export interface AppIconCategory {
  id: string;
  labelKey: MessageKey;
  entries: AppIconEntry[];
}

export interface AppIconGroup {
  id: "block" | "item";
  labelKey: MessageKey;
  categories: AppIconCategory[];
}

type CategoryMap = Record<string, string[]>;

function collect(kind: "block" | "item", categories: CategoryMap): AppIconEntry[] {
  return Object.keys(categories)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((file) => ({ id: `${kind}/${file}`, file }));
}

function byCategory(
  entries: AppIconEntry[],
  categories: CategoryMap,
  category: string
): AppIconEntry[] {
  return entries.filter((entry) => categories[entry.file]?.includes(category));
}

const BLOCKS = collect("block", blockCategories);
const ITEMS = collect("item", itemCategories);

export const APP_ICON_GROUPS: AppIconGroup[] = [
  {
    id: "block",
    labelKey: "iconPicker.block",
    categories: [
      { id: "all", labelKey: "iconPicker.blockAll", entries: BLOCKS },
      { id: "building_block", labelKey: "iconPicker.buildingBlock", entries: byCategory(BLOCKS, blockCategories, "building_block") },
      { id: "colored_block", labelKey: "iconPicker.coloredBlock", entries: byCategory(BLOCKS, blockCategories, "colored_block") },
      { id: "functional_block", labelKey: "iconPicker.functionalBlock", entries: byCategory(BLOCKS, blockCategories, "functional_block") },
      { id: "natural_block", labelKey: "iconPicker.naturalBlock", entries: byCategory(BLOCKS, blockCategories, "natural_block") },
      { id: "redstone_block", labelKey: "iconPicker.redstoneBlock", entries: byCategory(BLOCKS, blockCategories, "redstone_block") }
    ]
  },
  {
    id: "item",
    labelKey: "iconPicker.item",
    categories: [
      { id: "all", labelKey: "iconPicker.itemAll", entries: ITEMS },
      { id: "combat", labelKey: "iconPicker.combat", entries: byCategory(ITEMS, itemCategories, "combat") },
      { id: "food_and_drink", labelKey: "iconPicker.food", entries: byCategory(ITEMS, itemCategories, "food_and_drink") },
      { id: "ingredient", labelKey: "iconPicker.ingredient", entries: byCategory(ITEMS, itemCategories, "ingredient") },
      { id: "spawn_egg", labelKey: "iconPicker.spawnEgg", entries: byCategory(ITEMS, itemCategories, "spawn_egg") },
      { id: "tool_and_utility", labelKey: "iconPicker.tool", entries: byCategory(ITEMS, itemCategories, "tool_and_utility") }
    ]
  }
];
