/** Tooltip 版式：内边距、换行、窗口尺寸与屏幕定位，全部按 MC 像素乘缩放 */

import type { TooltipLine } from "./tooltipContent";

export const TOOLTIP_FONT_FAMILY = "CraftSharpUnifont";
export const TOOLTIP_BORDER_PIXELS = 3;

const MAX_WIDTH_PIXELS = 150;
const PADDING_PIXELS = 3;
const FONT_PIXELS = 8;
const LINE_HEIGHT_PIXELS = 8;
const SHADOW_OFFSET_PIXELS = 0.53;
const SIDE_OFFSET_PIXELS = 2;
const SCREEN_MARGIN_PIXELS = 5;

export interface TooltipMetrics {
  scale: number;
  padding: number;
  fontSize: number;
  lineHeight: number;
  /** 含内边距的最大宽度 */
  maxWidth: number;
  /** 文本可用的最大宽度 */
  contentMaxWidth: number;
  shadowOffset: number;
}

export function tooltipMetrics(scale: number): TooltipMetrics {
  const maxWidth = MAX_WIDTH_PIXELS * scale;
  const padding = PADDING_PIXELS * scale;

  return {
    scale,
    padding,
    fontSize: FONT_PIXELS * scale,
    lineHeight: LINE_HEIGHT_PIXELS * scale,
    maxWidth,
    contentMaxWidth: Math.max(1, maxWidth - padding * 2),
    shadowOffset: SHADOW_OFFSET_PIXELS * scale
  };
}

export function tooltipFont(fontSize: number): string {
  return `${fontSize}px "${TOOLTIP_FONT_FAMILY}", monospace`;
}

export interface TooltipLayout {
  width: number;
  height: number;
  rows: TooltipLine[];
}

/** 从空格处回退换行，避免切断英文单词；没有可用断点就硬切 */
function breakPoint(text: string): number {
  const spaceIndex = text.lastIndexOf(" ");
  if (spaceIndex > 0 && spaceIndex < text.length - 1) return spaceIndex;
  return -1;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (text.length === 0) return [""];
  if (ctx.measureText(text).width <= maxWidth) return [text];

  const rows: string[] = [];
  let current = "";

  for (const char of text) {
    if (current.length === 0) {
      current = char;
      continue;
    }

    if (ctx.measureText(current + char).width <= maxWidth) {
      current += char;
      continue;
    }

    const index = breakPoint(current);
    if (index > 0) {
      rows.push(current.slice(0, index));
      current = `${current.slice(index + 1)}${char}`;
    } else {
      rows.push(current);
      current = char;
    }
  }

  if (current.length > 0) rows.push(current);
  return rows;
}

/** 先换行再按最长行定宽，调用前需设置 ctx.font */
export function layoutTooltip(
  ctx: CanvasRenderingContext2D,
  lines: TooltipLine[],
  metrics: TooltipMetrics
): TooltipLayout {
  const rows: TooltipLine[] = [];
  for (const line of lines) {
    for (const text of wrapText(ctx, line.text, metrics.contentMaxWidth)) {
      rows.push({ text, color: line.color });
    }
  }

  let naturalWidth = 0;
  for (const row of rows) {
    naturalWidth = Math.max(naturalWidth, ctx.measureText(row.text).width);
  }

  const minimumWidth = TOOLTIP_BORDER_PIXELS * metrics.scale * 2;
  const width = Math.min(metrics.maxWidth, Math.max(minimumWidth, Math.ceil(naturalWidth) + metrics.padding * 2));
  const height = Math.max(
    minimumWidth,
    rows.length * metrics.lineHeight + metrics.padding * 2
  );

  return { width, height, rows };
}

/** 文本阴影色 = 文字色 × 0.5，与原 WPF DropShadowEffect 同源 */
export function shadowColorOf(color: string): string {
  const normalized = color.replace("#", "").trim();
  const value = normalized.length === 8 ? normalized.slice(2) : normalized;
  if (value.length !== 6) return "rgb(0, 0, 0)";

  const r = Math.round(parseInt(value.slice(0, 2), 16) * 0.5);
  const g = Math.round(parseInt(value.slice(2, 4), 16) * 0.5);
  const b = Math.round(parseInt(value.slice(4, 6), 16) * 0.5);
  return `rgb(${r}, ${g}, ${b})`;
}

/** 屏幕逻辑像素矩形 */
export interface TooltipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TooltipWorkArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 贴在格子右侧垂直居中，右边放不下翻到左侧，上下超界贴边 */
export function placeTooltip(
  anchor: TooltipRect,
  size: { width: number; height: number },
  scale: number,
  workArea: TooltipWorkArea
): { x: number; y: number } {
  const offset = SIDE_OFFSET_PIXELS * scale;
  const margin = SCREEN_MARGIN_PIXELS * scale;

  let x = anchor.x + anchor.width + offset;
  let y = anchor.y + (anchor.height - size.height) / 2;

  if (x + size.width > workArea.right) {
    x = anchor.x - size.width - offset;
  }

  if (y + size.height > workArea.bottom) {
    y = workArea.bottom - size.height - margin;
  }

  if (y < workArea.top) {
    y = workArea.top + margin;
  }

  return { x: Math.round(x), y: Math.round(y) };
}
