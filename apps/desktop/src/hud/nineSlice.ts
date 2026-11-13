/** 九宫格贴图绘制：四角不拉伸，边单向拉伸，中心双向拉伸，像素对齐 */

import { intrinsicSize } from "./canvasDraw";

export interface NineSliceOptions {
  /** 源图边框宽度，单位源图像素 */
  border: number;
  /** MC 像素缩放，目标边框宽度 = border * scale */
  scale: number;
}

export function drawNineSlice(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  options: NineSliceOptions
) {
  const source = intrinsicSize(image);
  const border = Math.round(options.border);
  if (border <= 0 || source.width <= border * 2 || source.height <= border * 2) return;

  const targetBorder = Math.max(1, Math.round(border * options.scale));
  const left = Math.round(x);
  const top = Math.round(y);
  const right = Math.round(x + width);
  const bottom = Math.round(y + height);
  if (right - left < targetBorder * 2 || bottom - top < targetBorder * 2) return;

  // 源图三段边界与目标三段边界，中间段承担拉伸
  const sourceX = [0, border, source.width - border];
  const sourceWidth = [border, source.width - border * 2, border];
  const targetX = [left, left + targetBorder, right - targetBorder];
  const targetWidth = [targetBorder, right - left - targetBorder * 2, targetBorder];

  const sourceY = [0, border, source.height - border];
  const sourceHeight = [border, source.height - border * 2, border];
  const targetY = [top, top + targetBorder, bottom - targetBorder];
  const targetHeight = [targetBorder, bottom - top - targetBorder * 2, targetBorder];

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const sourceW = sourceWidth[column];
      const sourceH = sourceHeight[row];
      const targetW = targetWidth[column];
      const targetH = targetHeight[row];
      if (sourceW <= 0 || sourceH <= 0 || targetW <= 0 || targetH <= 0) continue;

      ctx.drawImage(
        image,
        sourceX[column],
        sourceY[row],
        sourceW,
        sourceH,
        targetX[column],
        targetY[row],
        targetW,
        targetH
      );
    }
  }

  ctx.imageSmoothingEnabled = previousSmoothing;
}
