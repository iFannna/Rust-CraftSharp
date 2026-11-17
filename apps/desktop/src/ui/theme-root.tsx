import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppConfig } from "@/config/useAppConfig";
import { isTauri } from "@/lib/runtime";
import { fontStackOf } from "@/settings/fonts";
import { useResolvedTheme } from "@/settings/theme";
import { TooltipProvider } from "@/ui/components/tooltip";
import "@/ui/scrollbars";

/** 把主题、语言、字号写到文档根节点，让 Dialog / Select 的 portal 也拿到同一套变量 */
export function ThemeRoot({ children }: { children: ReactNode }) {
  const config = useAppConfig();
  const theme = useResolvedTheme(config.appearance.theme);

  // 运行期新建的窗口默认带打包图标，挂载时同步一次当前选择的应用图标
  useEffect(() => {
    if (!isTauri()) return;
    void invoke("sync_window_icon").catch(() => undefined);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.lang = config.system.language;
    root.style.setProperty("--ui-font", `${config.appearance.fontSize}px`);
    root.style.fontFamily = fontStackOf(config.appearance.font);
  }, [
    theme,
    config.system.language,
    config.appearance.fontSize,
    config.appearance.font,
  ]);

  return <TooltipProvider delayDuration={300}>{children}</TooltipProvider>;
}
