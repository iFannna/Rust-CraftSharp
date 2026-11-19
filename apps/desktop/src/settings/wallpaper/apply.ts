/** 壁纸应用：把模式选择转换为布局计划，成功后写回配置 */

import { getConfig, updateConfig } from "@/config/appConfig";
import {
  applyLayout,
  type ApplyPlan,
  type ApplyResult,
  type SpanTransform,
  type WallpaperItem,
  type WallpaperMode,
  type WallpaperMonitor
} from "./api";

export const DEFAULT_SPAN: SpanTransform = { zoom: 1, offsetX: 0, offsetY: 0 };

export async function applyWallpaper(
  item: WallpaperItem,
  mode: WallpaperMode,
  selected: string[],
  transform: SpanTransform,
  monitors: WallpaperMonitor[]
): Promise<ApplyResult> {
  const config = getConfig();
  const entry = { id: item.id, type: item.kind } as const;
  let plan: ApplyPlan;
  let commit: () => void;

  if (mode === "span") {
    plan = { mode, monitors: [], span: { entry, transform } };
    commit = () =>
      updateConfig({
        wallpaper: {
          mode,
          span: {
            id: item.id,
            title: item.title,
            type: item.kind,
            localPath: "",
            previewPath: item.previewUrl
          },
          transforms: { ...config.wallpaper.transforms, [item.id]: transform }
        }
      });
  } else if (mode === "independent") {
    const monitorsMap = { ...config.wallpaper.monitors };
    for (const device of selected) {
      monitorsMap[device] = {
        id: item.id,
        title: item.title,
        type: item.kind,
        localPath: "",
        previewPath: item.previewUrl
      };
    }
    const targets = Object.entries(monitorsMap)
      .filter(([device]) => monitors.some((monitor) => monitor.devicePath === device))
      .map(([monitor, target]) => ({
        monitor,
        entry: { id: target.id, type: target.type }
      }));
    plan = { mode, monitors: targets };
    commit = () => updateConfig({ wallpaper: { mode, monitors: monitorsMap } });
  } else {
    plan = { mode: "sync", sync: entry, monitors: [] };
    commit = () =>
      updateConfig({
        wallpaper: {
          mode: "sync",
          currentId: item.id,
          title: item.title,
          type: item.kind,
          localPath: ""
        }
      });
  }

  const result = await applyLayout(plan);
  commit();
  return result;
}
