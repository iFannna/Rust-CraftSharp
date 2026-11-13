/** Tooltip 内容行模型，顺序与颜色对齐原 WPF 实现 */

import { autoFileNameColor, displayNameOf, type SlotItem } from "./slotStore";

export interface TooltipLine {
  text: string;
  color: string;
}

export interface TooltipContentOptions {
  missing: boolean;
  showFileName: boolean;
  showOriginalName: boolean;
  showFilePath: boolean;
  showFileType: boolean;
  /** 配置值，auto 时按文件名自动取色 */
  fileNameColor: string;
}

const COLOR_ORIGINAL_NAME = "#FCFC54";
const COLOR_FILE_PATH = "#A8A8A8";
const COLOR_FILE_TYPE = "#5454FC";
const COLOR_FILE_MISSING = "#FC5454";
const NO_EXTENSION_TEXT = "(无后缀)";
const FILE_MISSING_TEXT = "文件已丢失";

function resolveFileNameColor(colorSetting: string, fileName: string): string {
  return colorSetting === "auto" ? autoFileNameColor(fileName) : colorSetting;
}

/** 与 Path.GetFileNameWithoutExtension 一致：最后一个点之后视为后缀，点开头不算后缀 */
export function fileNameWithoutExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

export function fileExtensionOf(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(dotIndex) : "";
}

export function buildTooltipLines(item: SlotItem, options: TooltipContentOptions): TooltipLine[] {
  const fileName = displayNameOf(item);

  if (options.missing) {
    return [
      { text: fileName, color: COLOR_ORIGINAL_NAME },
      { text: FILE_MISSING_TEXT, color: COLOR_FILE_MISSING }
    ];
  }

  const lines: TooltipLine[] = [];

  if (options.showFileName) {
    const stem = fileNameWithoutExtension(fileName);
    lines.push({ text: stem, color: resolveFileNameColor(options.fileNameColor, stem) });
  }

  if (options.showOriginalName) {
    lines.push({ text: fileName, color: COLOR_ORIGINAL_NAME });
  }

  if (options.showFilePath) {
    lines.push({ text: item.path, color: COLOR_FILE_PATH });
  }

  if (options.showFileType) {
    const extension = fileExtensionOf(fileName);
    lines.push({ text: extension || NO_EXTENSION_TEXT, color: COLOR_FILE_TYPE });
  }

  // 所有开关关闭时至少显示文件名不含后缀
  if (lines.length === 0) {
    const stem = fileNameWithoutExtension(fileName);
    lines.push({ text: stem, color: resolveFileNameColor(options.fileNameColor, stem) });
  }

  return lines;
}
