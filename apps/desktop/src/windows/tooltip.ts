/** Tooltip 窗口页：绘制九宫格底图与文本，按内容调整自身尺寸与位置 */

import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import unifontUrl from "@assets/fonts/unifont-16.0.04.ttf";
import tooltipBackgroundUrl from "@assets/minecraft/textures/gui/sprites/tooltip/background.png";
import tooltipFrameUrl from "@assets/minecraft/textures/gui/sprites/tooltip/frame.png";
import { loadImage } from "@/hud/statusbar/assets";
import { drawNineSlice } from "@/hud/shared/nineSlice";
import type { TooltipLine } from "@/hud/tooltip/content";
import {
  layoutTooltip,
  placeTooltip,
  shadowColorOf,
  tooltipFont,
  tooltipMetrics,
  TOOLTIP_BORDER_PIXELS,
  TOOLTIP_FONT_FAMILY,
  type TooltipRect,
  type TooltipWorkArea
} from "@/hud/tooltip/layout";

export interface TooltipContentPayload {
  lines: TooltipLine[];
  /** 物品栏缩放，缺省时按屏幕宽度推断，与物品栏保持同一公式 */
  scale?: number;
  /** 目标格子，屏幕逻辑像素 */
  anchor: TooltipRect;
  /** 所在显示器工作区，屏幕逻辑像素 */
  screen: TooltipWorkArea;
}

const canvasNode = document.querySelector<HTMLCanvasElement>("#tooltip");
if (!canvasNode) throw new Error("Tooltip 画布缺失");
const canvas: HTMLCanvasElement = canvasNode;

const ctx = createContext();

function createContext(): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建 Canvas 2D 上下文");
  return context;
}

const params = new URLSearchParams(location.search);
const forcedScale = Number(params.get("scale"));
const autoScale = Math.max(1, (window.screen.width / 2560) * 6);
const defaultScale = Number.isFinite(forcedScale) && forcedScale > 0 ? forcedScale : autoScale;

const tauriWindow = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

const background = await loadImage(tooltipBackgroundUrl);
const frame = await loadImage(tooltipFrameUrl);
await loadFont();

let generation = 0;

async function loadFont() {
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:"${TOOLTIP_FONT_FAMILY}";src:url("${unifontUrl}") format("truetype");font-display:block;}`;
  document.head.append(style);

  try {
    await document.fonts.load(`16px "${TOOLTIP_FONT_FAMILY}"`);
  } catch {
    // 字体加载失败时退回等宽字体，仍可显示内容
  }
}

function draw(lines: TooltipLine[], scale: number) {
  const metrics = tooltipMetrics(scale);

  ctx.font = tooltipFont(metrics.fontSize);
  const layout = layoutTooltip(ctx, lines, metrics);
  const width = Math.ceil(layout.width);
  const height = Math.ceil(layout.height);

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  const slice = { border: TOOLTIP_BORDER_PIXELS, scale };
  drawNineSlice(ctx, background, 0, 0, width, height, slice);
  drawNineSlice(ctx, frame, 0, 0, width, height, slice);

  ctx.font = tooltipFont(metrics.fontSize);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  layout.rows.forEach((row, index) => {
    const x = metrics.padding;
    const y = metrics.padding + index * metrics.lineHeight;

    // 阴影先画，偏移右下等价于 WPF Direction 315 + ShadowDepth
    ctx.fillStyle = shadowColorOf(row.color);
    ctx.fillText(row.text, x + metrics.shadowOffset, y + metrics.shadowOffset);

    ctx.fillStyle = row.color;
    ctx.fillText(row.text, x, y);
  });

  return { width, height };
}

async function handleContent(payload: TooltipContentPayload) {
  const scale = payload.scale && payload.scale > 0 ? payload.scale : defaultScale;
  const token = ++generation;
  const size = draw(payload.lines ?? [], scale);

  if (!tauriWindow) return;

  const currentWindow = getCurrentWindow();
  await currentWindow.setSize(new LogicalSize(size.width, size.height));
  if (token !== generation) return;

  const position = placeTooltip(payload.anchor, size, scale, payload.screen);
  await currentWindow.setPosition(new LogicalPosition(position.x, position.y));
  if (token !== generation) return;

  await currentWindow.show();
}

async function handleHide() {
  generation += 1;
  if (!tauriWindow) return;
  await getCurrentWindow().hide();
}

if (tauriWindow) {
  // 提示框只显示，不参与命中，避免挡住下方格子
  await getCurrentWindow().setIgnoreCursorEvents(true);
  await listen<TooltipContentPayload>("tooltip:content", ({ payload }) => {
    void handleContent(payload);
  });
  await listen("tooltip:hide", () => {
    void handleHide();
  });
  void warmUp();
}

/** 预热窗口合成：第一次悬停才显示时不再卡一下 */
async function warmUp() {
  const win = getCurrentWindow();
  try {
    await win.setSize(new LogicalSize(8, 8));
    await win.setPosition(new LogicalPosition(-400, -400));
    await win.show();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await win.hide();
  } catch {
    // 预热失败不影响正常显示
  }
}

document.body.dataset.ready = "true";
