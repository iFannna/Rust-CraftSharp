import { invoke } from "@tauri-apps/api/core";
import { HUD_ASSETS, loadImage } from "./assets";
import type { SlotIcon } from "./statusbar";

export interface SlotIconSource {
  path: string;
  showTargetIcon?: boolean;
}

/** 是否运行在 Tauri 宿主内，浏览器预览时没有原生图标提取 */
export function hasIconBackend(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const iconCache = new Map<string, Promise<SlotIcon | null>>();
let barrierImage: Promise<HTMLImageElement> | null = null;

function loadBarrier(): Promise<HTMLImageElement> {
  barrierImage ??= loadImage(HUD_ASSETS.barrier);
  return barrierImage;
}

/**
 * 取格子图标。
 * 文件图标按原 WPF 规则走 HighQuality，文件丢失或提取失败回退占位图并按 NearestNeighbor 绘制。
 */
export function loadSlotIcon(source: SlotIconSource): Promise<SlotIcon | null> {
  const key = `${source.showTargetIcon ? 1 : 0}\u0001${source.path}`;
  let pending = iconCache.get(key);
  if (!pending) {
    pending = requestSlotIcon(source);
    iconCache.set(key, pending);
  }
  return pending;
}

async function requestSlotIcon(source: SlotIconSource): Promise<SlotIcon | null> {
  if (!hasIconBackend()) return null;

  try {
    const dataUrl = await invoke<string | null>("slot_icon", {
      path: source.path,
      showTargetIcon: source.showTargetIcon ?? false
    });

    if (!dataUrl) {
      return { image: await loadBarrier(), smooth: false };
    }

    return { image: await loadImage(dataUrl), smooth: true };
  } catch (error) {
    console.warn("格子图标提取失败", source.path, error);
    return { image: await loadBarrier(), smooth: false };
  }
}

/** 文件或快捷方式变更后清缓存，path 为空时清空全部 */
export function invalidateSlotIcons(path?: string): void {
  if (path === undefined) {
    iconCache.clear();
    return;
  }

  for (const key of [...iconCache.keys()]) {
    if (key.endsWith(`\u0001${path}`)) {
      iconCache.delete(key);
    }
  }
}
