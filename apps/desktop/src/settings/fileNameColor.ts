/** 文件名颜色：字段只存一个字符串，"auto" 表示按文件名自动取色，其余为十六进制 */

export const AUTO_FILE_NAME_COLOR = "auto";
export const DEFAULT_FILE_NAME_COLOR = "#FCFCFC";

export const FILE_NAME_COLOR_PRESETS: { value: string; label: string }[] = [
  { value: "#FCFCFC", label: "白色" },
  { value: "#A8A8A8", label: "灰色" },
  { value: "#FCFC54", label: "黄色" },
  { value: "#5454FC", label: "蓝色" },
  { value: "#FC54FC", label: "粉色" },
  { value: "#A800A8", label: "紫色" },
  { value: "#FC5454", label: "红色" },
  { value: "#54FCFC", label: "青色" },
  { value: "#00A800", label: "绿色" }
];

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isAutoColor(value: string): boolean {
  return value === AUTO_FILE_NAME_COLOR;
}

export function isPresetColor(value: string): boolean {
  return FILE_NAME_COLOR_PRESETS.some((preset) => preset.value.toUpperCase() === value.toUpperCase());
}

export function isHexColor(value: string): boolean {
  return HEX_PATTERN.test(value);
}

/** 下拉框选项：auto、9 个预设、自定义（当前值不属于前三者时） */
export type ColorSelectValue = "auto" | string;

export function colorSelectValueOf(value: string): ColorSelectValue {
  if (isAutoColor(value)) return AUTO_FILE_NAME_COLOR;
  if (isPresetColor(value)) return value.toUpperCase();
  return "custom";
}

/** input[type=color] 只接受 #rrggbb，非法值回退到默认色 */
export function toColorInputValue(value: string): string {
  if (isHexColor(value)) return value.toLowerCase();
  return DEFAULT_FILE_NAME_COLOR.toLowerCase();
}
