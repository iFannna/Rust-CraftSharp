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

export function captureSession() {
  return invoke<void>("wallpaper_capture_session");
}

export function logout() {
  return invoke<void>("wallpaper_logout");
}
