import type { HudElementId } from "@/config/appConfig";

/** 原版状态栏图标样式，值为文件名前缀，空串表示默认 */
export interface IconStyleOption {
  value: string;
  label: string;
}

const HEART_STYLES: IconStyleOption[] = [
  { value: "", label: "默认" },
  { value: "poisoned", label: "剧毒" },
  { value: "withered", label: "凋零" },
  { value: "frozen", label: "冰冻" },
  { value: "hardcore", label: "硬核" },
  { value: "vehicle", label: "载具" }
];

const FOOD_STYLES: IconStyleOption[] = [
  { value: "", label: "默认" },
  { value: "hunger", label: "饥饿" }
];

const EXP_STYLES: IconStyleOption[] = [
  { value: "", label: "普通" },
  { value: "jump", label: "跳跃" }
];

const ABSORBING_STYLES: IconStyleOption[] = [
  { value: "", label: "默认" },
  { value: "hardcore", label: "硬核" }
];

export function iconStyleOptions(id: HudElementId): IconStyleOption[] | null {
  if (id === "health") return HEART_STYLES;
  if (id === "food") return FOOD_STYLES;
  if (id === "absorbing") return ABSORBING_STYLES;
  if (id === "expBar") return EXP_STYLES;
  return null;
}

// 直接打包全部状态图标，避免运行时按需拼路径
const heartFiles = import.meta.glob(
  "../../../../../assets/minecraft/textures/gui/sprites/hud/heart/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

const foodFiles = import.meta.glob(
  "../../../../../assets/minecraft/textures/gui/sprites/hud/food/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

const expFiles = import.meta.glob(
  "../../../../../assets/minecraft/textures/gui/sprites/hud/experience_bar/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

function find(files: Record<string, string>, name: string): string | undefined {
  return Object.entries(files).find(([path]) => path.endsWith(`/${name}`))?.[1];
}

function heart(name: string, fallback: string): string {
  return find(heartFiles, name) ?? find(heartFiles, fallback) ?? "";
}

function food(name: string): string {
  return find(foodFiles, name) ?? find(foodFiles, "food_empty.png") ?? "";
}

export interface RowStyleUrls {
  background: string;
  full: string;
  half: string;
  backgroundFlash: string;
  fullFlash: string;
  halfFlash: string;
}

/** 生命、食物、伤害吸收三行的样式贴图地址 */
export function rowStyleUrls(id: "health" | "food" | "absorbing", style: string): RowStyleUrls {
  if (id === "food") {
    const suffix = style === "hunger" ? "_hunger" : "";
    return {
      background: food(`food_empty${suffix}.png`),
      full: food(`food_full${suffix}.png`),
      half: food(`food_half${suffix}.png`),
      backgroundFlash: food(`food_empty${suffix}.png`),
      fullFlash: food(`food_full${suffix}.png`),
      halfFlash: food(`food_half${suffix}.png`)
    };
  }

  if (id === "absorbing") {
    const prefix = style === "hardcore" ? "absorbing_hardcore" : "absorbing";
    const container = heart("container.png", "container.png");
    return {
      background: container,
      full: heart(`${prefix}_full.png`, "absorbing_full.png"),
      half: heart(`${prefix}_half.png`, "absorbing_half.png"),
      backgroundFlash: heart("container_blinking.png", "container_blinking.png"),
      fullFlash: heart(`${prefix}_full_blinking.png`, "absorbing_full_blinking.png"),
      halfFlash: heart(`${prefix}_half_blinking.png`, "absorbing_half_blinking.png")
    };
  }

  const prefix = style ? `${style}_` : "";
  const container = style === "hardcore" || style === "vehicle" ? `container_${style}.png` : "container.png";
  return {
    background: heart(container, "container.png"),
    full: heart(`${prefix}full.png`, "full.png"),
    half: heart(`${prefix}half.png`, "half.png"),
    backgroundFlash: heart(style === "hardcore" ? "container_hardcore_blinking.png" : "container_blinking.png", "container_blinking.png"),
    fullFlash: heart(`${prefix}full_blinking.png`, "full_blinking.png"),
    halfFlash: heart(`${prefix}half_blinking.png`, "half_blinking.png")
  };
}

/** 经验条普通与跳跃样式 */
export function expStyleUrls(style: string): { background: string; progress: string } {
  const prefix = style === "jump" ? "jump_bar" : "experience_bar";
  return {
    background: find(expFiles, `${prefix}_background.png`) ?? "",
    progress: find(expFiles, `${prefix}_progress.png`) ?? ""
  };
}

/** 设置面板里元素卡片的预览图标 */
export function stylePreviewUrl(id: HudElementId, style: string): string {
  if (id === "health") return rowStyleUrls("health", style).full;
  if (id === "food") return rowStyleUrls("food", style).full;
  if (id === "absorbing") return rowStyleUrls("absorbing", style).full;
  if (id === "expBar") return expStyleUrls(style).progress;
  return "";
}
