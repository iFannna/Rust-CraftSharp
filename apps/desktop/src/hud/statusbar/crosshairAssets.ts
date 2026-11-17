/** 准星与攻击指示器贴图：目前只有原版一套，仅用于设置页预览 */

const files = import.meta.glob(
  "../../../../../assets/minecraft/textures/gui/sprites/hud/crosshair/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

function find(name: string): string {
  return Object.entries(files).find(([path]) => path.endsWith(`/${name}`))?.[1] ?? "";
}

export const CROSSHAIR_ICON = find("crosshair.png");
export const ATTACK_INDICATOR_ICON = find("crosshair_attack_indicator_full.png");
