/**
 * 应用图标：id 形如 block/stone.png，贴图由 Vite 按稳定路径提供。
 * 选中后裁成方形 PNG，交给 Rust 同步托盘、任务栏与程序文件。
 */

import { invoke } from "@tauri-apps/api/core";
import defaultAppIconUrl from "../../src-tauri/icons/icon.ico?url";

export const DEFAULT_APP_ICON = "";
export const DEFAULT_APP_ICON_URL = defaultAppIconUrl;

export function appIconUrl(id: string): string {
  return id ? `/textures/${id}` : DEFAULT_APP_ICON_URL;
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
