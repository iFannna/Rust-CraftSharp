import unifontUrl from "@assets/fonts/unifont-16.0.04.ttf";
import zpixUrl from "@assets/fonts/zpix.ttf";
import type { UIFont } from "@/config/appConfig";

const FONT_FACES: Record<string, { family: string; url: string }> = {
  unifont: { family: "CraftSharpUnifont", url: unifontUrl },
  pixel: { family: "CraftSharpZpix", url: zpixUrl }
};

const FONT_STACKS: Record<UIFont, string> = {
  system: 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
  yahei: '"Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
  pixel: '"CraftSharpZpix", "Microsoft YaHei", monospace',
  unifont: '"CraftSharpUnifont", "Microsoft YaHei", monospace',
  songti: 'SimSun, "Microsoft YaHei", serif',
  kaiti: 'KaiTi, "Microsoft YaHei", serif',
  heiti: 'SimHei, "Microsoft YaHei", sans-serif'
};

let injected = false;

/** 设置面板字体选择里只有像素字体需要内嵌文件 */
export function ensureSettingsFonts(): void {
  if (injected) return;
  const rules = Object.values(FONT_FACES)
    .map(({ family, url }) => `@font-face{font-family:"${family}";src:url("${url}");font-display:block;}`)
    .join("");
  const style = document.createElement("style");
  style.textContent = rules;
  document.head.append(style);
  injected = true;
}

export function fontStackOf(font: UIFont): string {
  return FONT_STACKS[font] ?? FONT_STACKS.yahei;
}
