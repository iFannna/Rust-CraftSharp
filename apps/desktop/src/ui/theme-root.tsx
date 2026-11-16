import { useLayoutEffect, type ReactNode } from "react";
import { useAppConfig } from "@/config/useAppConfig";
import { fontStackOf } from "@/settings/fonts";
import { useResolvedTheme } from "@/settings/theme";

/** 把主题、语言、字号写到文档根节点，让 Dialog / Select 的 portal 也拿到同一套变量 */
export function ThemeRoot({ children }: { children: ReactNode }) {
  const config = useAppConfig();
  const theme = useResolvedTheme(config.appearance.theme);

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

  return children;
}
