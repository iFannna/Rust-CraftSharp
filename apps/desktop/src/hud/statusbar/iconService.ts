import { invoke } from "@tauri-apps/api/core";
import { HUD_ASSETS, loadImage } from "@/hud/statusbar/assets";
import type { SlotIcon } from "@/hud/slots/types";

export interface SlotIconSource {
  path: string;
  showTargetIcon?: boolean;
  /** 目标像素尺寸，缺省 32；解码在后台完成，传大了也不会卡 UI */
  size?: number;
}

/** 是否运行在 Tauri 宿主内，浏览器预览时没有原生图标提取 */
export function hasIconBackend(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const iconCache = new Map<string, Promise<SlotIcon | null>>();
const missingPaths = new Set<string>();
let barrierImage: Promise<HTMLImageElement> | null = null;

function loadBarrier(): Promise<HTMLImageElement> {
  barrierImage ??= loadImage(HUD_ASSETS.barrier);
  return barrierImage;
}

/** 文件是否缺失。图标加载失败时记录，用于隐藏文件名等判断 */
export function isPathMissing(path: string): boolean {
  return missingPaths.has(path);
}

/**
 * 取格子图标。
 * 文件图标按原 WPF 规则走 HighQuality，文件丢失或提取失败回退占位图并按 NearestNeighbor 绘制。
 */
export function loadSlotIcon(source: SlotIconSource): Promise<SlotIcon | null> {
  const size = Math.min(128, Math.max(1, Math.round(source.size ?? 32)));
  const key = `${source.showTargetIcon ? 1 : 0}\u0001${size}\u0001${source.path}`;
  let pending = iconCache.get(key);
  if (!pending) {
    pending = requestSlotIcon(source, size);
    iconCache.set(key, pending);
  }
  return pending;
}

async function requestSlotIcon(source: SlotIconSource, size: number): Promise<SlotIcon | null> {
  if (!hasIconBackend()) return null;

  try {
    const dataUrl = await invoke<string | null>("slot_icon", {
      path: source.path,
      showTargetIcon: source.showTargetIcon ?? false,
      size
    });

    if (!dataUrl) {
      missingPaths.add(source.path);
      return { image: await loadBarrier(), smooth: false };
    }

    missingPaths.delete(source.path);
    return { image: await loadImage(dataUrl), smooth: true };
  } catch (error) {
    console.warn("格子图标提取失败", source.path, error);
    missingPaths.add(source.path);
    return { image: await loadBarrier(), smooth: false };
  }
}

/** 文件或快捷方式变更后清缓存，path 为空时清空全部 */
export function invalidateSlotIcons(path?: string): void {
  if (path === undefined) {
    iconCache.clear();
    missingPaths.clear();
    return;
  }

  missingPaths.delete(path);
  for (const key of [...iconCache.keys()]) {
    if (key.endsWith(`\u0001${path}`)) {
      iconCache.delete(key);
    }
  }
}
