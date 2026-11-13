/** HUD 布局基准常量，全部来自原 WPF 实现，单位是 MC GUI 像素 */
export const BASE = {
  coreWidth: 182,
  hotbarHeight: 22,
  expHeight: 5,
  expMargin: 2,
  icon: 9,
  iconGap: -1,
  verticalGap: 1,
  margin: 3,
  slot: 16,
  slotSpacing: 4,
  dropZoneExpansion: 2,
  selectionWidth: 24,
  selectionHeight: 23
} as const;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StatusBarLayout {
  scale: number;
  coreWidth: number;
  width: number;
  height: number;
  iconSize: number;
  gap: number;
  verticalGap: number;
  hotbarTop: number;
  hotbarHeight: number;
  expTop: number;
  expHeight: number;
  expMargin: number;
  statusTop: number;
  healthTop: number;
  absorptionTop: number;
  armorTop: number;
  foodTop: number;
  airTop: number;
}

export function computeLayout(scale: number): StatusBarLayout {
  const icon = BASE.icon * scale;
  const gap = BASE.iconGap * scale;
  const verticalGap = BASE.verticalGap * scale;
  const coreWidth = BASE.coreWidth * scale;
  const hotbarHeight = BASE.hotbarHeight * scale;
  const expHeight = BASE.expHeight * scale;
  const expMargin = BASE.expMargin * scale;

  const statusRows = 3;
  const statusHeight = statusRows * icon + (statusRows - 1) * verticalGap;
  const height = hotbarHeight + expMargin + expHeight + verticalGap + statusHeight;

  const hotbarTop = height - hotbarHeight;
  const expTop = hotbarTop - expMargin - expHeight;
  const statusTop = expTop - verticalGap;

  const healthTop = statusTop - icon;
  const absorptionTop = healthTop - verticalGap - icon;
  const armorTop = absorptionTop - verticalGap - icon;
  const foodTop = statusTop - icon;
  const airTop = foodTop - verticalGap - icon;

  return {
    scale,
    coreWidth,
    width: coreWidth,
    height,
    iconSize: icon,
    gap,
    verticalGap,
    hotbarTop,
    hotbarHeight,
    expTop,
    expHeight,
    expMargin,
    statusTop,
    healthTop,
    absorptionTop,
    armorTop,
    foodTop,
    airTop
  };
}

/** 主快捷栏第 index 个格子（0-8）的可命中区域，含 2 像素外扩 */
export function slotDropRect(layout: StatusBarLayout, index: number): Rect {
  const scale = layout.scale;
  return {
    left: (BASE.margin - BASE.dropZoneExpansion + index * (BASE.slot + BASE.slotSpacing)) * scale,
    top: layout.hotbarTop + (BASE.margin - BASE.dropZoneExpansion) * scale,
    width: (BASE.slot + 2 * BASE.dropZoneExpansion) * scale,
    height: (BASE.slot + 2 * BASE.dropZoneExpansion) * scale
  };
}

/** 主快捷栏第 index 个格子的图标绘制区域 */
export function slotIconRect(layout: StatusBarLayout, index: number): Rect {
  const scale = layout.scale;
  return {
    left: (BASE.margin + index * (BASE.slot + BASE.slotSpacing)) * scale,
    top: layout.hotbarTop + BASE.margin * scale,
    width: BASE.slot * scale,
    height: BASE.slot * scale
  };
}

/** 选中框位置 */
export function selectionRect(layout: StatusBarLayout, index: number): Rect {
  const scale = layout.scale;
  const columnWidth = (BASE.slot + BASE.slotSpacing) * scale;
  const canvasMargin = (BASE.margin - BASE.dropZoneExpansion) * scale;
  return {
    left: canvasMargin + index * columnWidth + (columnWidth - BASE.selectionWidth * scale) / 2,
    top: layout.hotbarTop - scale,
    width: BASE.selectionWidth * scale,
    height: BASE.selectionHeight * scale
  };
}

/** 命中测试，返回全局格子索引（2-10），未命中返回 -1 */
export function slotIndexAtPoint(layout: StatusBarLayout, x: number, y: number): number {
  for (let index = 0; index < 9; index += 1) {
    const rect = slotDropRect(layout, index);
    if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) {
      return index + 2;
    }
  }
  return -1;
}
