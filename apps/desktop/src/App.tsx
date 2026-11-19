import { useEffect } from "react";
import { getConfig } from "@/config/appConfig";
import { applyConfiguredVisibility, setSettingsVisible } from "@/lib/windowControls";
import { initializeTray } from "@/lib/tray";
import { reapplyStaticWallpaper } from "@/lib/wallpaperRestore";

/**
 * 主窗口只承担宿主职责：初始化窗口显隐、接管托盘手势。
 * 产品入口是托盘与全局热键，不再提供卡片式主界面。
 */
export default function App() {
  useEffect(() => {
    void (async () => {
      await applyConfiguredVisibility().catch(() => undefined);
      if (getConfig().system.defaultOpenSettings) {
        await setSettingsVisible(true).catch(() => undefined);
      }
      // 动态壁纸由原生侧恢复；静态壁纸跟随当前存储路径重设
      await reapplyStaticWallpaper().catch(() => undefined);
    })();

    return initializeTray();
  }, []);

  return null;
}
