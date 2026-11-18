/** 文件名颜色：字段只存一个字符串，"auto" 表示按文件名自动取色，其余为十六进制 */

export const AUTO_FILE_NAME_COLOR = "auto";
export const OTHER_FILE_NAME_COLOR = "other";
export const DEFAULT_FILE_NAME_COLOR = "#FCFCFC";

export const FILE_NAME_COLOR_PRESETS: string[] = [
  "#FCFCFC",
  "#A8A8A8",
  "#FCFC54",
  "#5454FC",
  "#FC54FC",
  "#A800A8",
  "#FC5454",
  "#54FCFC",
  "#00A800"
];

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isAutoColor(value: string): boolean {
  return value === AUTO_FILE_NAME_COLOR;
}

/** 支持 #RRGGBB 与取色窗返回的 #AARRGGBB */
export function isHexColor(value: string): boolean {
  return HEX_PATTERN.test(value);
}

/** 下拉与色块只显示 RGB 部分 */
export function rgbHexOf(value: string): string {
  const hex = value.replace(/^#/, "");
  return `#${hex.length === 8 ? hex.slice(2) : hex}`.toUpperCase();
}

/** 与预设比较时忽略 alpha */
export function presetColorOf(value: string): string | null {
  if (!isHexColor(value)) return null;
  const rgb = rgbHexOf(value);
  return FILE_NAME_COLOR_PRESETS.find((preset) => preset === rgb) ?? null;
}

/** #AARRGGBB 转成 CSS 的 rgba，避免被当成 #RRGGBBAA 解析 */
export function cssColorOf(value: string): string {
  const hex = value.replace(/^#/, "");
  if (hex.length !== 8) return `#${hex}`;
  const alpha = parseInt(hex.slice(0, 2), 16) / 255;
  const r = parseInt(hex.slice(2, 4), 16);
  const g = parseInt(hex.slice(4, 6), 16);
  const b = parseInt(hex.slice(6, 8), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
