/** 静态壁纸跟随存储路径重设；动态壁纸由原生侧在启动时恢复 */

import { getConfig, type WallpaperKind } from "@/config/appConfig";
import { isTauri } from "@/lib/runtime";
import { applyLayout, type ApplyPlan, type SpanTransform } from "@/settings/wallpaper/api";

const DEFAULT_TRANSFORM: SpanTransform = { zoom: 1, offsetX: 0, offsetY: 0 };

function planFor(kind: WallpaperKind): ApplyPlan | null {
  const wallpaper = getConfig().wallpaper;

  if (wallpaper.mode === "sync" && wallpaper.type === kind && wallpaper.currentId) {
    return {
      mode: "sync",
      sync: { id: wallpaper.currentId, type: kind },
      monitors: []
    };
  }

  if (wallpaper.mode === "independent") {
    const monitors = Object.entries(wallpaper.monitors)
      .filter(([, entry]) => entry.type === kind)
      .map(([monitor, entry]) => ({ monitor, entry: { id: entry.id, type: kind } }));
    return monitors.length ? { mode: "independent", monitors } : null;
  }

  if (wallpaper.mode === "span" && wallpaper.span?.type === kind) {
    return {
      mode: "span",
      monitors: [],
      span: {
        entry: { id: wallpaper.span.id, type: kind },
        transform: wallpaper.transforms[wallpaper.span.id] ?? DEFAULT_TRANSFORM
      }
    };
  }

  return null;
}

/** 缓存位置变化后重新交给系统，同一张图不产生可见切换 */
export async function reapplyStaticWallpaper(): Promise<void> {
  if (!isTauri()) return;
  const plan = planFor("static");
  if (plan) await applyLayout(plan);
}
