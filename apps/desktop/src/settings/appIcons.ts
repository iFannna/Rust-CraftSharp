/**
 * 应用图标资源：26.3 官方方块与物品贴图，按创造栏分类。
 * 选择结果只存 id，源图交给 Rust 统一生成托盘、任务栏与 exe 图标。
 */

import { invoke } from "@tauri-apps/api/core";
import defaultAppIconUrl from "../../src-tauri/icons/icon.ico?url";
import blockCategories from "@assets/minecraft/textures/block/data/categories.json";
import itemCategories from "@assets/minecraft/textures/item/data/categories.json";
import type { MessageKey } from "@/i18n";

export const DEFAULT_APP_ICON = "";
export const DEFAULT_APP_ICON_URL = defaultAppIconUrl;

interface AppIconEntry {
  id: string;
  file: string;
  url: string;
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

const blockUrls = import.meta.glob("@assets/minecraft/textures/block/*.png", {
  eager: true,
  query: "?url&no-inline",
  import: "default"
}) as Record<string, string>;

const itemUrls = import.meta.glob("@assets/minecraft/textures/item/*.png", {
  eager: true,
  query: "?url&no-inline",
  import: "default"
}) as Record<string, string>;

function collect(urls: Record<string, string>, kind: "block" | "item"): AppIconEntry[] {
  return Object.entries(urls)
    .map(([path, url]) => {
      const file = path.slice(path.lastIndexOf("/") + 1);
      return { id: `${kind}/${file}`, file, url };
    })
    .sort((a, b) => a.file.localeCompare(b.file, "en", { numeric: true }));
}

const BLOCKS = collect(blockUrls, "block");
const ITEMS = collect(itemUrls, "item");
const URLS = new Map([...BLOCKS, ...ITEMS].map((entry) => [entry.id, entry.url]));

function byCategory(
  entries: AppIconEntry[],
  categories: Record<string, string[]>,
  category: string
): AppIconEntry[] {
  return entries.filter((entry) => categories[entry.file]?.includes(category));
}

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

export function appIconUrl(id: string): string {
  return URLS.get(id) ?? defaultAppIconUrl;
}

/** 动画贴图是竖向帧条，只取首帧的方形区域，避免被压扁 */
async function renderIconSource(id: string): Promise<string> {
  const image = new Image();
  image.src = appIconUrl(id);
  await image.decode();

  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2d context unavailable");
  context.drawImage(image, 0, 0, side, side, 0, 0, side, side);

  const prefix = "data:image/png;base64,";
  return canvas.toDataURL("image/png").slice(prefix.length);
}

/** 应用图标；返回 null 表示成功，否则是可展示的错误信息 */
export async function applyAppIcon(id: string): Promise<string | null> {
  try {
    const png = id ? await renderIconSource(id) : null;
    await invoke("set_app_icon", { png });
    return null;
  } catch (error) {
    return typeof error === "string" ? error : "无法更新应用图标";
  }
}
