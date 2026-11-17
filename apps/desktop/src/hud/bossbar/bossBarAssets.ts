/** BOSS 血条预览贴图：与 HUD 渲染共用同一批原版贴图 */

const files = import.meta.glob(
  "../../../../../assets/minecraft/textures/gui/sprites/hud/boss_bar/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

function find(name: string): string {
  return Object.entries(files).find(([path]) => path.endsWith(`/${name}`))?.[1] ?? "";
}

export function bossBarProgress(color: string): string {
  return find(`${color}_progress.png`);
}

export function bossBarNotchProgress(notch: string): string {
  return notch ? find(`${notch}_progress.png`) : "";
}
