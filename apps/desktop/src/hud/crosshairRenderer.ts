import { draw } from "./canvasDraw";
import type { CrosshairLayout } from "./crosshairLayout";

export interface CrosshairImages {
  crosshair: CanvasImageSource;
  attackBackground: CanvasImageSource;
  attackProgress: CanvasImageSource;
  attackFull: CanvasImageSource;
}

export interface CrosshairModel {
  layout: CrosshairLayout;
  images: CrosshairImages;
  crosshairVisible: boolean;
  attackIndicatorVisible: boolean;
  /** 0-1，1 表示满进度 */
  percent: number;
}

/** 准星固定画在画布正中心 */
export function drawCrosshair(ctx: CanvasRenderingContext2D, image: CanvasImageSource, layout: CrosshairLayout) {
  const rect = layout.crosshair;
  draw(ctx, image, rect.left, rect.top, rect.width, rect.height);
}

/**
 * 进度 = 100% 只画 full；小于 100% 画 background + 按 percent 裁剪的 progress，
 * 与 WPF 中 progress 的 Clip 行为一致。
 */
export function drawAttackIndicator(
  ctx: CanvasRenderingContext2D,
  images: CrosshairImages,
  layout: CrosshairLayout,
  percent: number
) {
  const ratio = Math.max(0, Math.min(1, percent));

  if (ratio >= 1) {
    const full = layout.attack.full;
    draw(ctx, images.attackFull, full.left, full.top, full.width, full.height);
    return;
  }

  const bar = layout.attack.bar;
  draw(ctx, images.attackBackground, bar.left, bar.top, bar.width, bar.height);

  const progress = layout.attack.progress;
  const clipWidth = Math.round(progress.left + progress.width * ratio) - progress.left;
  if (clipWidth <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(progress.left, progress.top, clipWidth, progress.height);
  ctx.clip();
  draw(ctx, images.attackProgress, progress.left, progress.top, progress.width, progress.height);
  ctx.restore();
}

/** 画布尺寸跟随屏幕逻辑宽高，整体重绘一次 */
export function drawCrosshairLayer(canvas: HTMLCanvasElement, model: CrosshairModel) {
  const { layout } = model;

  if (canvas.width !== layout.width) canvas.width = layout.width;
  if (canvas.height !== layout.height) canvas.height = layout.height;
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 Canvas 2D 上下文");

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (model.crosshairVisible) drawCrosshair(ctx, model.images.crosshair, layout);
  if (model.attackIndicatorVisible) drawAttackIndicator(ctx, model.images, layout, model.percent);
}
