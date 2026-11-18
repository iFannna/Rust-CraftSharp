/** 壁纸服务与本地应用命令，前端的唯一数据入口 */

import { invoke } from "@tauri-apps/api/core";

export type WallpaperKind = "all" | "static" | "dynamic";
export type WallpaperSort = "latest" | "hot" | "downloads";

export interface WallpaperItem {
  id: string;
  title: string;
  kind: "static" | "dynamic";
  thumbnailUrl: string;
  previewUrl: string;
  resolution: string;
}

export interface WallpaperPage {
  items: WallpaperItem[];
  page: number;
  totalPages: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function listWallpapers(page: number, kind: WallpaperKind, sort: WallpaperSort) {
  return invoke<WallpaperPage>("wallpaper_list", { page, kind, sort });
}

/** 下载并应用静态壁纸，返回本地缓存路径 */
export function applyWallpaper(item: WallpaperItem) {
  return invoke<string>("wallpaper_apply", {
    id: item.id,
    previewUrl: item.previewUrl
  });
}

/** 系统保存对话框，取消返回 null */
export function pickSavePath(title: string) {
  return invoke<string | null>("wallpaper_pick_path", { title });
}

export function exportWallpaper(item: WallpaperItem, path: string) {
  return invoke<void>("wallpaper_export", {
    previewUrl: item.previewUrl,
    path
  });
}
