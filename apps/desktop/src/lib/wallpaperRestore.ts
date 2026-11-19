/** 启动时恢复动态壁纸；静态壁纸由 Windows 持久化，不重复设置 */

import { getConfig } from "@/config/appConfig";
import { isTauri } from "@/lib/runtime";
import { applyLayout, type ApplyPlan, type SpanTransform } from "@/settings/wallpaper/api";

const DEFAULT_TRANSFORM: SpanTransform = { zoom: 1, offsetX: 0, offsetY: 0 };

export async function restoreDynamicWallpaper(): Promise<void> {
  if (!isTauri()) return;
  const wallpaper = getConfig().wallpaper;

  let plan: ApplyPlan | null = null;
  if (wallpaper.mode === "sync" && wallpaper.type === "dynamic" && wallpaper.currentId) {
    plan = {
      mode: "sync",
      sync: { id: wallpaper.currentId, type: "dynamic" },
      monitors: []
    };
  } else if (wallpaper.mode === "independent") {
    const monitors = Object.entries(wallpaper.monitors)
      .filter(([, entry]) => entry.type === "dynamic")
      .map(([monitor, entry]) => ({
        monitor,
        entry: { id: entry.id, type: "dynamic" as const }
      }));
    if (monitors.length) plan = { mode: "independent", monitors };
  } else if (wallpaper.mode === "span" && wallpaper.span?.type === "dynamic") {
    plan = {
      mode: "span",
      monitors: [],
      span: {
        entry: { id: wallpaper.span.id, type: "dynamic" },
        transform: wallpaper.transforms[wallpaper.span.id] ?? DEFAULT_TRANSFORM
      }
    };
  }

  if (plan) await applyLayout(plan).catch(() => undefined);
}
