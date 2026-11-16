/**
 * 托盘图标资源：26.3 官方方块与物品贴图，按创造栏分类。
 * 选择结果只存 id，选中后绘制 32px PNG 交给 Rust 设置托盘并落盘。
 */

import { invoke } from "@tauri-apps/api/core";
import appIconUrl from "../../src-tauri/icons/icon.ico?url";
import blockCategories from "@assets/minecraft/textures/block/data/categories.json";
import itemCategories from "@assets/minecraft/textures/item/data/categories.json";
import type { MessageKey } from "@/i18n";

export const DEFAULT_TRAY_ICON = "";
export const DEFAULT_TRAY_ICON_URL = appIconUrl;

interface TrayIconEntry {
  id: string;
  file: string;
  url: string;
}

export interface TrayIconCategory {
  id: string;
  labelKey: MessageKey;
  entries: TrayIconEntry[];
}

export interface TrayIconGroup {
  id: "block" | "item";
  labelKey: MessageKey;
  categories: TrayIconCategory[];
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

function collect(urls: Record<string, string>, kind: "block" | "item"): TrayIconEntry[] {
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
  entries: TrayIconEntry[],
  categories: Record<string, string[]>,
  category: string
): TrayIconEntry[] {
  return entries.filter((entry) => categories[entry.file]?.includes(category));
}

export const TRAY_ICON_GROUPS: TrayIconGroup[] = [
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

export function trayIconUrl(id: string): string {
  return URLS.get(id) ?? appIconUrl;
}

async function renderTrayIconPng(id: string): Promise<string> {
  const image = new Image();
  image.src = trayIconUrl(id);
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2d context unavailable");
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const prefix = "data:image/png;base64,";
  return canvas.toDataURL("image/png").slice(prefix.length);
}

/** 立即替换托盘图标；id 为空时恢复默认应用图标并删除自定义图标文件 */
export async function applyTrayIcon(id: string): Promise<void> {
  try {
    const png = id ? await renderTrayIconPng(id) : null;
    await invoke("set_tray_icon", { png });
  } catch {
    // 托盘不可用时保持现状，配置仍会记录用户的选择
  }
}
