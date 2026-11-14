/** HUD 布局基准常量，全部来自原 WPF 实现，单位是 MC GUI 像素 */
export const BASE = {
  coreWidth: 182,
  hotbarHeight: 22,
  expHeight: 5,
  expMargin: 2,
  icon: 9,
  iconGap: -1,
  rowGap: 1,
  margin: 3,
  slot: 16,
  slotSpacing: 4,
  dropZoneExpansion: 2,
  selectionWidth: 24,
  selectionHeight: 23,
  offhandSize: 22,
  offhandSpacing: 7,
  absorbingPerRow: 10,
  absorbingMaxGapAdjustment: 7
} as const;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OffhandConfig {
  left: boolean;
  right: boolean;
}

export interface StatusBarVisibility {
  health: boolean;
  food: boolean;
  air: boolean;
  armor: boolean;
  absorbing: boolean;
  expBar: boolean;
  hotbar: boolean;
}

export const ALL_VISIBLE: StatusBarVisibility = {
  health: true,
  food: true,
  air: true,
  armor: true,
  absorbing: true,
  expBar: true,
  hotbar: true
};

export interface AbsorbingLayout {
  /** 整块顶边，行号越大越靠上 */
  top: number;
  rows: number;
  height: number;
  rowGap: number;
}

export interface StatusBarLayout {
  scale: number;
  coreWidth: number;
  /** 核心容器左边界：两侧副手槽列固定占位，即使隐藏也保留宽度 */
  coreLeft: number;
  width: number;
  height: number;
  /** 状态行单个图标边长，9 MC 像素 */
  iconSize: number;
  /** 快捷栏与副手槽图标区边长，16 MC 像素 */
  slotSize: number;
  /** 同一行图标的水平间距 */
  gap: number;
  /** 上下元素之间的基准间距 */
  rowGap: number;
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
  absorbing: AbsorbingLayout;
  offhand: OffhandConfig;
  visible: StatusBarVisibility;
}

/**
 * 复刻 WPF 的 StackPanel 重力布局：整块贴底，隐藏元素后上方元素向下掉落。
 * 每个元素保留原来的下边距，即使成为最下面一项，边距仍然占位。
 */
export function computeLayout(
  scale: number,
  offhand: OffhandConfig = { left: false, right: false },
  visible: StatusBarVisibility = ALL_VISIBLE,
  maxAbsorption = 20
): StatusBarLayout {
  const icon = BASE.icon * scale;
  const gap = BASE.iconGap * scale;
  const rowGap = BASE.rowGap * scale;
  const coreWidth = BASE.coreWidth * scale;
  const hotbarHeight = BASE.hotbarHeight * scale;
  const expHeight = BASE.expHeight * scale;
  const expMargin = BASE.expMargin * scale;
  const coreLeft = (BASE.offhandSize + BASE.offhandSpacing) * scale;

  // 伤害吸收每行 10 个向上堆叠，行距随行数递减，最多减 7
  const absorbingSlots = Math.max(0, Math.floor(maxAbsorption / 2));
  const rows = Math.max(1, Math.ceil(absorbingSlots / BASE.absorbingPerRow));
  const gapAdjustment = Math.min(rows - 1, BASE.absorbingMaxGapAdjustment);
  const absorbingRowGap = rowGap - gapAdjustment * scale;
  const absorbingHeight = rows * icon + (rows - 1) * absorbingRowGap;

  // 左列自下而上：生命值、伤害吸收、护甲值
  let left = 0;
  let healthOffset = 0;
  let absorbingOffset = 0;
  let armorOffset = 0;
  if (visible.health) {
    healthOffset = left;
    left += icon;
  }
  if (visible.absorbing) {
    left += absorbingRowGap;
    absorbingOffset = left;
    left += absorbingHeight;
  }
  if (visible.armor) {
    left += rowGap;
    armorOffset = left;
    left += icon;
  }
  const leftHeight = left;

  // 右列自下而上：饥饿值、空气值
  let right = 0;
  let foodOffset = 0;
  let airOffset = 0;
  if (visible.food) {
    foodOffset = right;
    right += icon;
  }
  if (visible.air) {
    right += rowGap;
    airOffset = right;
    right += icon;
  }
  const rightHeight = right;

  const statusHeight = Math.max(leftHeight, rightHeight);
  const height =
    (visible.hotbar ? hotbarHeight : 0) +
    (visible.expBar ? expMargin + expHeight : 0) +
    rowGap +
    statusHeight;

  let cursor = height;
  let hotbarTop = cursor;
  if (visible.hotbar) {
    cursor -= hotbarHeight;
    hotbarTop = cursor;
  }
  let expTop = cursor;
  if (visible.expBar) {
    cursor -= expMargin + expHeight;
    expTop = cursor;
  }
  cursor -= rowGap;
  const statusBottom = cursor;

  return {
    scale,
    coreWidth,
    coreLeft,
    width: coreWidth + coreLeft * 2,
    height,
    iconSize: icon,
    slotSize: BASE.slot * scale,
    gap,
    rowGap,
    hotbarTop,
    hotbarHeight,
    expTop,
    expHeight,
    expMargin,
    statusTop: statusBottom - statusHeight,
    healthTop: statusBottom - healthOffset - icon,
    absorptionTop: statusBottom - absorbingOffset - absorbingHeight,
    armorTop: statusBottom - armorOffset - icon,
    foodTop: statusBottom - foodOffset - icon,
    airTop: statusBottom - airOffset - icon,
    absorbing: {
      top: statusBottom - absorbingOffset - absorbingHeight,
      rows,
      height: absorbingHeight,
      rowGap: absorbingRowGap
    },
    offhand,
    visible
  };
}

/** 主快捷栏第 index 个格子（0-8）的可命中区域，含 2 像素外扩 */
export function slotDropRect(layout: StatusBarLayout, index: number): Rect {
  const scale = layout.scale;
  return {
    left: layout.coreLeft + (BASE.margin - BASE.dropZoneExpansion + index * (BASE.slot + BASE.slotSpacing)) * scale,
    top: layout.hotbarTop + (BASE.margin - BASE.dropZoneExpansion) * scale,
    width: (BASE.slot + 2 * BASE.dropZoneExpansion) * scale,
    height: (BASE.slot + 2 * BASE.dropZoneExpansion) * scale
  };
}

/** 主快捷栏第 index 个格子的图标绘制区域 */
export function slotIconRect(layout: StatusBarLayout, index: number): Rect {
  const scale = layout.scale;
  return {
    left: layout.coreLeft + (BASE.margin + index * (BASE.slot + BASE.slotSpacing)) * scale,
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
    left: layout.coreLeft + canvasMargin + index * columnWidth + (columnWidth - BASE.selectionWidth * scale) / 2,
    top: layout.hotbarTop - scale,
    width: BASE.selectionWidth * scale,
    height: BASE.selectionHeight * scale
  };
}

/** 副手槽外框，side 0 为左、1 为右 */
export function offhandBoxRect(layout: StatusBarLayout, side: 0 | 1): Rect {
  const scale = layout.scale;
  const size = BASE.offhandSize * scale;
  return {
    left: side === 0 ? 0 : layout.width - size,
    top: layout.hotbarTop,
    width: size,
    height: size
  };
}

/** 副手槽图标区域，与外框同样内缩 margin */
export function offhandIconRect(layout: StatusBarLayout, side: 0 | 1): Rect {
  const scale = layout.scale;
  const box = offhandBoxRect(layout, side);
  return {
    left: box.left + BASE.margin * scale,
    top: box.top + BASE.margin * scale,
    width: BASE.slot * scale,
    height: BASE.slot * scale
  };
}

/** 副手槽命中区域，20x20 居中于 22x22 外框 */
export function offhandDropRect(layout: StatusBarLayout, side: 0 | 1): Rect {
  const scale = layout.scale;
  const box = offhandBoxRect(layout, side);
  const size = (BASE.slot + 2 * BASE.dropZoneExpansion) * scale;
  return {
    left: box.left + (BASE.margin - BASE.dropZoneExpansion) * scale,
    top: box.top + (BASE.margin - BASE.dropZoneExpansion) * scale,
    width: size,
    height: size
  };
}

function hit(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
}

/**
 * 命中测试，返回全局格子索引：0 左副手、1 右副手、2-10 主快捷栏，未命中返回 -1。
 * 判定顺序与 WPF 一致：主快捷栏 → 左副手 → 右副手。
 */
export function slotIndexAtPoint(layout: StatusBarLayout, x: number, y: number): number {
  if (!layout.visible.hotbar) return -1;

  for (let index = 0; index < 9; index += 1) {
    if (hit(slotDropRect(layout, index), x, y)) return index + 2;
  }

  if (layout.offhand.left && hit(offhandDropRect(layout, 0), x, y)) return 0;
  if (layout.offhand.right && hit(offhandDropRect(layout, 1), x, y)) return 1;

  return -1;
}
