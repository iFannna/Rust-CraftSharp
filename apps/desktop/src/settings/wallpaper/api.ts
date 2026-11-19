/** 壁纸服务、布局应用与登录态，前端的唯一数据入口 */

import { invoke } from "@tauri-apps/api/core";

export type WallpaperKind = "all" | "static" | "dynamic";
export type WallpaperSort = "latest" | "popular" | "downloads";
export type WallpaperMode = "sync" | "independent" | "span";

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

export interface WallpaperMonitor {
  devicePath: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  primary: boolean;
}

export interface SpanTransform {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface PlanEntry {
  id: string;
  type: "static" | "dynamic";
}

export interface ApplyPlan {
  mode: WallpaperMode;
  sync?: PlanEntry;
  monitors: { monitor: string; entry: PlanEntry }[];
  span?: { entry: PlanEntry; transform: SpanTransform };
}

export interface ApplyResult {
  applied: string[];
  warnings: string[];
}

export function listWallpapers(page: number, kind: WallpaperKind, sort: WallpaperSort) {
  return invoke<WallpaperPage>("wallpaper_list", { page, kind, sort });
}

export function fetchMonitors() {
  return invoke<WallpaperMonitor[]>("wallpaper_monitors");
}

export function applyLayout(plan: ApplyPlan) {
  return invoke<ApplyResult>("wallpaper_apply_layout", { plan });
}

/** 系统保存对话框，取消返回 null */
export function pickSavePath(title: string) {
  return invoke<string | null>("wallpaper_pick_path", { title });
}

export function exportWallpaper(id: string, path: string) {
  return invoke<void>("wallpaper_export", { id, path });
}

export function sessionStatus() {
  return invoke<boolean>("wallpaper_session");
}

export function storagePath() {
  return invoke<string>("wallpaper_storage");
}

/** 切换存储目录并迁移现有缓存，返回实际生效的新路径 */
export function migrateStorage(path: string) {
  return invoke<string>("wallpaper_migrate_storage", { path });
}

/** 恢复默认存储目录，返回实际生效的路径 */
export function resetStorage() {
  return invoke<string>("wallpaper_reset_storage");
}

/** 在资源管理器中打开当前存储目录 */
export function openStorage() {
  return invoke<void>("wallpaper_open_storage");
}

/** 系统文件夹选择器，取消返回 null */
export function pickFolder(title: string) {
  return invoke<string | null>("wallpaper_pick_folder", { title });
}

export function captureSession() {
  return invoke<void>("wallpaper_capture_session");
}

export function logout() {
  return invoke<void>("wallpaper_logout");
}
