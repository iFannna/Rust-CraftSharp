import { useEffect, useState } from "react";
import type { ThemeMode } from "@/config/appConfig";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function prefersDarkNow(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

/** system 模式下跟随系统主题，系统配色变化时重新求值 */
export function useResolvedTheme(mode: ThemeMode): "dark" | "light" {
  const [prefersDark, setPrefersDark] = useState(prefersDarkNow);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setPrefersDark(media.matches);
    setPrefersDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}
