/** 壁纸预览与设置窗口：已打开时复用并广播最新壁纸 */

import { emit } from "@tauri-apps/api/event";
import { getConfig } from "@/config/appConfig";
import { tOf } from "@/i18n";
import { findAppWindow, focusAppWindow, openAppWindow } from "@/lib/appWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import type { WallpaperItem, WallpaperKind, WallpaperSort } from "./api";

export const PREVIEW_EVENT = "wallpaper:preview";
export const APPLY_EVENT = "wallpaper:apply";

export interface PreviewRequest {
  item: WallpaperItem;
  page: number;
  kind: WallpaperKind;
  sort: WallpaperSort;
  index: number;
}

function itemParams(item: WallpaperItem): Record<string, string> {
  return {
    id: item.id,
    title: item.title,
    type: item.kind,
    thumbnail: item.thumbnailUrl,
    preview: item.previewUrl,
    resolution: item.resolution
  };
}

export function itemFromParams(params: URLSearchParams): WallpaperItem {
  return {
    id: params.get("id") ?? "",
    title: params.get("title") ?? "",
    kind: params.get("type") === "dynamic" ? "dynamic" : "static",
    thumbnailUrl: params.get("thumbnail") ?? "",
    previewUrl: params.get("preview") ?? "",
    resolution: params.get("resolution") ?? ""
  };
}

export function previewRequestFromParams(params: URLSearchParams): PreviewRequest {
  const kind = params.get("kind");
  const sort = params.get("sort");
  return {
    item: itemFromParams(params),
    page: Math.max(1, Number(params.get("page")) || 1),
    kind: kind === "static" || kind === "dynamic" ? kind : "all",
    sort: sort === "popular" || sort === "downloads" ? sort : "latest",
    index: Math.max(0, Number(params.get("index")) || 0)
  };
}

export async function openWallpaperLogin(title: string): Promise<void> {
  const existing = await findAppWindow(WINDOW_LABEL.wallpaperLogin);
  if (existing) {
    await focusAppWindow(existing);
    return;
  }

  await openAppWindow({
    label: WINDOW_LABEL.wallpaperLogin,
    title,
    page: "wallpaper-login",
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
    anchor: WINDOW_LABEL.settings
  });
}

export async function openWallpaperPreview(request: PreviewRequest): Promise<void> {
  const t = tOf(getConfig().system.language);
  const existing = await findAppWindow(WINDOW_LABEL.wallpaperPreview);
  if (existing) {
    await emit(PREVIEW_EVENT, request).catch(() => undefined);
    await focusAppWindow(existing);
    return;
  }

  const params = itemParams(request.item);
  params.page = String(request.page);
  params.kind = request.kind;
  params.sort = request.sort;
  params.index = String(request.index);

  await openAppWindow({
    label: WINDOW_LABEL.wallpaperPreview,
    title: t("wallpaper.previewTitle"),
    page: "wallpaper-preview",
    params,
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
    anchor: WINDOW_LABEL.settings
  });
}

export async function openWallpaperApply(
  item: WallpaperItem,
  anchor: string = WINDOW_LABEL.settings
): Promise<void> {
  const t = tOf(getConfig().system.language);
  const existing = await findAppWindow(WINDOW_LABEL.wallpaperApply);
  if (existing) {
    await emit(APPLY_EVENT, item).catch(() => undefined);
    await focusAppWindow(existing);
    return;
  }

  await openAppWindow({
    label: WINDOW_LABEL.wallpaperApply,
    title: t("wallpaper.setWallpaper"),
    page: "wallpaper-apply",
    params: itemParams(item),
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
    anchor
  });
}
