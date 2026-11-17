/** 物品栏容器贴图：样式预览窗口按文件名取图 */

const files = import.meta.glob(
  "../../../../../assets/minecraft/textures/gui/container/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

export function containerStyleUrl(file: string): string {
  return Object.entries(files).find(([path]) => path.endsWith(`/${file}`))?.[1] ?? "";
}
