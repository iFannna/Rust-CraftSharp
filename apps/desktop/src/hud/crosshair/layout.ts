/** 准星窗口布局，缩放与位置规则对齐 WPF CrosshairWindow */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TextureSize {
  width: number;
  height: number;
}

export interface CrosshairTextures {
  crosshair: TextureSize;
  background: TextureSize;
  progress: TextureSize;
  full: TextureSize;
}

export interface AttackIndicatorLayout {
  /** background 与 progress 共用尺寸 */
  bar: Rect;
  progress: Rect;
  full: Rect;
}

export interface CrosshairLayout {
  scale: number;
  width: number;
  height: number;
  crosshair: Rect;
  attack: AttackIndicatorLayout;
}

export const SCALE_BASE = {
  /* 2560 逻辑像素宽度下放大 6 倍 */
  screenWidth: 2560,
  multiplier: 6,
  /* 攻击指示器与准星底边的间距，单位是 MC GUI 像素 */
  attackIndicatorSpacing: 1
} as const;

/** ?scale= 优先，否则按屏幕逻辑宽度换算 */
export function resolveScale(screenWidth: number, forced?: number): number {
  if (forced !== undefined && Number.isFinite(forced) && forced > 0) return forced;
  return (screenWidth / SCALE_BASE.screenWidth) * SCALE_BASE.multiplier;
}

/** 四边取整，绘制与裁剪共用同一套整数坐标 */
export function snapRect(x: number, y: number, width: number, height: number): Rect {
  const left = Math.round(x);
  const top = Math.round(y);
  const right = Math.round(x + width);
  const bottom = Math.round(y + height);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function computeCrosshairLayout(
  scale: number,
  screenWidth: number,
  screenHeight: number,
  textures: CrosshairTextures
): CrosshairLayout {
  const crosshairWidth = textures.crosshair.width * scale;
  const crosshairHeight = textures.crosshair.height * scale;

  const crosshair = snapRect(
    screenWidth / 2 - crosshairWidth / 2,
    screenHeight / 2 - crosshairHeight / 2,
    crosshairWidth,
    crosshairHeight
  );

  const barWidth = textures.background.width * scale;
  const barHeight = textures.background.height * scale;
  const fullWidth = textures.full.width * scale;
  const fullHeight = textures.full.height * scale;

  // 整体宽度取 background 与 full 的较大者，与 WPF AttackIndicatorGrid 一致
  const boxWidth = Math.max(barWidth, fullWidth);
  const boxLeft = screenWidth / 2 - boxWidth / 2;
  // 垂直位置 = 屏幕中线 + 准星高 / 2 + 间距
  const boxTop = screenHeight / 2 + crosshairHeight / 2 + SCALE_BASE.attackIndicatorSpacing * scale;

  return {
    scale,
    width: Math.max(1, Math.round(screenWidth)),
    height: Math.max(1, Math.round(screenHeight)),
    crosshair,
    attack: {
      bar: snapRect(boxLeft + (boxWidth - barWidth) / 2, boxTop, barWidth, barHeight),
      // progress 左对齐，裁剪后从左往右增长
      progress: snapRect(boxLeft, boxTop, barWidth, barHeight),
      full: snapRect(boxLeft + (boxWidth - fullWidth) / 2, boxTop, fullWidth, fullHeight)
    }
  };
}
