import unifontUrl from "@assets/fonts/unifont-16.0.04.ttf";
import type { UIFont } from "@/config/appConfig";

const FONT_FACES: Record<string, { family: string; url: string }> = {
  unifont: { family: "CraftSharpUnifont", url: unifontUrl }
};

/** 只内置 Unifont，其余走各平台自带的系统字体 */
const SYSTEM_SANS =
  'system-ui, -apple-system, "Segoe UI", "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

const FONT_STACKS: Record<UIFont, string> = {
  system: SYSTEM_SANS,
  yahei: SYSTEM_SANS,
  pixel: SYSTEM_SANS,
  unifont: '"CraftSharpUnifont", ' + SYSTEM_SANS,
  songti: 'Georgia, "Noto Serif CJK SC", "Noto Serif SC", "Songti SC", SimSun, serif',
  kaiti: '"Kaiti SC", KaiTi, STKaiti, "Noto Serif CJK SC", serif',
  heiti: '"PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", SimHei, sans-serif'
};

let injected = false;

/** 只有 Unifont 需要内嵌文件 */
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
  return FONT_STACKS[font] ?? SYSTEM_SANS;
}
