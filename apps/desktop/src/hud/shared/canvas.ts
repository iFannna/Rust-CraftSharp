/** Canvas 整数像素绘制工具，HUD 与物品栏共用 */

export function intrinsicSize(image: CanvasImageSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
  }
  if (image instanceof HTMLCanvasElement || image instanceof ImageBitmap) {
    return { width: image.width, height: image.height };
  }
  return { width: 0, height: 0 };
}

/** 四边取整后绘制，避免小数坐标产生半像素模糊 */
export function draw(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const left = Math.round(x);
  const top = Math.round(y);
  const right = Math.round(x + width);
  const bottom = Math.round(y + height);

  ctx.drawImage(image, left, top, Math.max(1, right - left), Math.max(1, bottom - top));
}

/**
 * 等比缩放后居中绘制，等价于 WPF Image 的 Stretch="Uniform"。
 * 非正方形资源会留出透明边，而不是被拉伸变形。
 */
export function drawUniform(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number
) {
  const source = intrinsicSize(image);
  if (source.width <= 0 || source.height <= 0) {
    draw(ctx, image, x, y, boxWidth, boxHeight);
    return;
  }

  const ratio = Math.min(boxWidth / source.width, boxHeight / source.height);
  const width = source.width * ratio;
  const height = source.height * ratio;
  draw(ctx, image, x + (boxWidth - width) / 2, y + (boxHeight - height) / 2, width, height);
}
