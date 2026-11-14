import { loadHudImages, type HudImages } from "@/hud/statusbar/assets";
import { draw, drawUniform } from "@/hud/shared/canvas";
import {
  BASE,
  computeLayout,
  maxLayout,
  offhandBoxRect,
  offhandIconRect,
  selectionRect,
  slotIconRect,
  type OffhandConfig,
  type StatusBarVisibility
} from "@/hud/statusbar/layout";

export interface SlotIcon {
  image: CanvasImageSource;
  smooth: boolean;
}

export interface StyledRowImages {
  background: CanvasImageSource;
  full: CanvasImageSource;
  half: CanvasImageSource;
  /** 闪烁态，仅生命值动画使用 */
  flash: {
    background: CanvasImageSource;
    full: CanvasImageSource;
    half: CanvasImageSource;
  };
}

export interface StyledImages {
  health: StyledRowImages;
  food: StyledRowImages;
  absorbing: StyledRowImages;
  exp: { background: CanvasImageSource; progress: CanvasImageSource };
}

export interface DragIcon {
  icon: SlotIcon;
  /** 画布内坐标，图标中心 */
  x: number;
  y: number;
}

export interface StatusBarModel {
  scale: number;
  /** 按全局格子索引排列：0 左副手、1 右副手、2-10 主快捷栏 */
  slotIcons?: Array<SlotIcon | null>;
  offhand?: OffhandConfig;
  visible?: StatusBarVisibility;
  styled?: StyledImages | null;
  /** 饥饿值饱和度，与最大值同单位 */
  saturation?: number;
  /** 生命值闪烁动画，previous 是变化前的值 */
  heartFlash?: { previous: number } | null;
  /** 空气值破裂动画，槽位区间 [from, to) */
  airBurst?: { from: number; to: number } | null;
  health: number;
  maxHealth: number;
  food: number;
  maxFood: number;
  air: number;
  maxAir: number;
  armor: number;
  maxArmor: number;
  absorption: number;
  maxAbsorption: number;
  exp: number;
  /** 全局格子索引，-1 表示无选中 */
  selectedSlot: number;
  hoverSlot?: number;
  /** 剪切态格子，图标半透明 */
  dimmedSlot?: number;
  drag?: DragIcon | null;
  /** 拖动时隐藏源格子的图标 */
  dragSourceSlot?: number;
}

export type StatusBarRenderer = (model: StatusBarModel) => void;

export async function createStatusBarRenderer(canvas: HTMLCanvasElement): Promise<StatusBarRenderer> {
  const images = await loadHudImages();
  return (model) => drawStatusBar(canvas, images, model);
}

function drawStatusBar(canvas: HTMLCanvasElement, images: HudImages, model: StatusBarModel) {
  const offhand = model.offhand ?? { left: false, right: false };
  const layout = computeLayout(model.scale, offhand, model.visible, model.maxAbsorption);
  const visible = layout.visible;
  const coreLeft = layout.coreLeft;
  const coreRight = coreLeft + layout.coreWidth;
  const { coreWidth, hotbarTop, hotbarHeight, expTop, expHeight, healthTop, armorTop, foodTop, airTop, iconSize, slotSize, gap } = layout;

  // 画布固定为最大内容尺寸，窗口变小时只裁剪，画布本身不重建
  const view = maxLayout(model.scale, model.maxAbsorption);
  const width = Math.ceil(view.width);
  const height = Math.ceil(view.height);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 Canvas 2D 上下文");

  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (visible.hotbar && offhand.left) {
    const box = offhandBoxRect(layout, 0);
    draw(ctx, images.hotbarOffhand, box.left, box.top, box.width, box.height);
  }
  if (visible.hotbar && offhand.right) {
    const box = offhandBoxRect(layout, 1);
    drawMirrored(ctx, images.hotbarOffhand, box.left, box.top, box.width, box.height);
  }

  if (visible.health) {
    drawHeartRow(
      ctx,
      model.styled?.health ?? defaultRow(images.heartContainer, images.heartFull, images.heartHalf, images.heartContainerBlinking, images.heartFullBlinking, images.heartHalfBlinking),
      coreLeft,
      healthTop,
      iconSize,
      gap,
      model.health,
      model.maxHealth,
      model.heartFlash ?? null
    );
  }
  if (visible.absorbing) {
    drawAbsorbingRow(
      ctx,
      model.styled?.absorbing ?? defaultRow(images.heartContainer, images.absorbingFull, images.absorbingHalf, images.heartContainerBlinking, images.absorbingFullBlinking, images.absorbingHalfBlinking),
      coreLeft,
      layout,
      model.absorption,
      model.maxAbsorption
    );
  }
  if (visible.armor) {
    drawRow(ctx, images.armorEmpty, images.armorFull, images.armorHalf, coreLeft, coreRight, armorTop, iconSize, gap, model.armor, model.maxArmor, false);
  }
  const foodRow = model.styled?.food;
  if (visible.food) {
    drawRow(ctx, foodRow?.background ?? images.foodEmpty, foodRow?.full ?? images.foodFull, foodRow?.half ?? images.foodHalf, coreLeft, coreRight, foodTop, iconSize, gap, model.food, model.maxFood, true);
    drawSaturation(ctx, images.saturationFull, images.saturationHalf, coreRight, foodTop, iconSize, gap, model.saturation ?? 0, model.maxFood);
  }
  if (visible.air) {
    drawAirRow(ctx, images.airEmpty, images.air, images.airBursting, coreLeft, coreRight, airTop, iconSize, gap, model.air, model.maxAir, model.airBurst ?? null);
  }

  if (visible.expBar) {
    const exp = model.styled?.exp;
    draw(ctx, exp?.background ?? images.expBackground, coreLeft, expTop, coreWidth, expHeight);
    const progress = Math.max(0, Math.min(1, model.exp / 100));
    if (progress > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(coreLeft, expTop, coreWidth * progress, expHeight);
      ctx.clip();
      draw(ctx, exp?.progress ?? images.expProgress, coreLeft, expTop, coreWidth, expHeight);
      ctx.restore();
    }
  }

  if (visible.hotbar) {
    draw(ctx, images.hotbar, coreLeft, hotbarTop, coreWidth, hotbarHeight);
  }

  if (visible.hotbar && model.slotIcons) {
    for (let index = 0; index < 9; index += 1) {
      const rect = slotIconRect(layout, index);
      drawSlotIcon(ctx, model, index + 2, rect.left, rect.top, slotSize);
    }

    if (offhand.left) {
      const rect = offhandIconRect(layout, 0);
      drawSlotIcon(ctx, model, 0, rect.left, rect.top, rect.width);
    }
    if (offhand.right) {
      const rect = offhandIconRect(layout, 1);
      drawSlotIcon(ctx, model, 1, rect.left, rect.top, rect.width);
    }
  }

  const selectionSlot = model.selectedSlot >= 2 ? model.selectedSlot : model.hoverSlot ?? -1;
  if (visible.hotbar && selectionSlot >= 2 && selectionSlot <= 10) {
    const rect = selectionRect(layout, selectionSlot - 2);
    draw(ctx, images.hotbarSelection, rect.left, rect.top, rect.width, rect.height);
  }

  if (model.drag) {
    const size = BASE.slot * model.scale;
    ctx.imageSmoothingEnabled = model.drag.icon.smooth;
    ctx.imageSmoothingQuality = model.drag.icon.smooth ? "high" : "low";
    drawUniform(ctx, model.drag.icon.image, model.drag.x - size / 2, model.drag.y - size / 2, size, size);
    ctx.imageSmoothingEnabled = false;
  }
}

function drawSlotIcon(
  ctx: CanvasRenderingContext2D,
  model: StatusBarModel,
  globalIndex: number,
  left: number,
  top: number,
  size: number
) {
  const slot = model.slotIcons?.[globalIndex];
  if (!slot) return;
  if (model.drag && model.dragSourceSlot === globalIndex) return;

  ctx.imageSmoothingEnabled = slot.smooth;
  ctx.imageSmoothingQuality = slot.smooth ? "high" : "low";
  if (model.dimmedSlot === globalIndex) ctx.globalAlpha = 0.5;
  drawUniform(ctx, slot.image, left, top, size, size);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  background: CanvasImageSource,
  full: CanvasImageSource,
  half: CanvasImageSource,
  left: number,
  right: number,
  top: number,
  icon: number,
  gap: number,
  value: number,
  max: number,
  rightAligned: boolean
) {
  const slots = Math.max(0, Math.floor(max / 2));
  const fullCount = Math.floor(value / 2);
  const hasHalf = value % 2 === 1;
  const step = icon + gap;

  for (let index = 0; index < slots; index += 1) {
    const x = rightAligned
      ? right - (index + 1) * step + gap
      : left + index * step;

    draw(ctx, background, x, top, icon, icon);

    if (index < fullCount) {
      draw(ctx, full, x, top, icon, icon);
    } else if (index === fullCount && hasHalf) {
      draw(ctx, half, x, top, icon, icon);
    }
  }
}

function drawAirRow(
  ctx: CanvasRenderingContext2D,
  empty: CanvasImageSource,
  full: CanvasImageSource,
  bursting: CanvasImageSource,
  left: number,
  right: number,
  top: number,
  icon: number,
  gap: number,
  value: number,
  max: number,
  burst: { from: number; to: number } | null
) {
  const slots = Math.max(0, Math.floor(max / 2));
  const fullCount = Math.floor(value / 2);
  const step = icon + gap;

  for (let index = 0; index < slots; index += 1) {
    const x = right - (index + 1) * step + gap;
    if (burst && index >= burst.from && index < burst.to) {
      // 破裂位置盖住空图标，持续 200ms
      draw(ctx, bursting, x, top, icon, icon);
    } else if (index < fullCount) {
      draw(ctx, full, x, top, icon, icon);
    } else {
      draw(ctx, empty, x, top, icon, icon);
    }
  }
}

function defaultRow(
  background: CanvasImageSource,
  full: CanvasImageSource,
  half: CanvasImageSource,
  backgroundFlash: CanvasImageSource,
  fullFlash: CanvasImageSource,
  halfFlash: CanvasImageSource
): StyledRowImages {
  return { background, full, half, flash: { background: backgroundFlash, full: fullFlash, half: halfFlash } };
}

/** 生命值行，闪烁时先画闪烁底图与掉血图标，再叠加当前图标 */
function drawHeartRow(
  ctx: CanvasRenderingContext2D,
  row: StyledRowImages,
  left: number,
  top: number,
  icon: number,
  gap: number,
  value: number,
  max: number,
  flash: { previous: number } | null
) {
  const slots = Math.max(0, Math.floor(max / 2));
  const step = icon + gap;
  const fullCount = Math.floor(value / 2);
  const hasHalf = value % 2 === 1;

  const previousFull = flash ? Math.floor(flash.previous / 2) : 0;
  const previousHalf = flash ? flash.previous % 2 === 1 : false;

  for (let index = 0; index < slots; index += 1) {
    const x = left + index * step;
    draw(ctx, flash ? row.flash.background : row.background, x, top, icon, icon);

    if (index < previousFull && index >= fullCount) {
      draw(ctx, row.flash.full, x, top, icon, icon);
    } else if (index === previousFull && previousHalf && index >= fullCount && !(index === fullCount && hasHalf)) {
      draw(ctx, row.flash.half, x, top, icon, icon);
    }
  }

  for (let index = 0; index < slots; index += 1) {
    const x = left + index * step;
    if (index < fullCount) {
      draw(ctx, row.full, x, top, icon, icon);
    } else if (index === fullCount && hasHalf) {
      draw(ctx, row.half, x, top, icon, icon);
    }
  }
}

/** 伤害吸收按行堆叠，从最后一个槽位开始画，前面的图标压住后面的 */
function drawAbsorbingRow(
  ctx: CanvasRenderingContext2D,
  row: StyledRowImages,
  left: number,
  layout: ReturnType<typeof computeLayout>,
  value: number,
  max: number
) {
  const slots = Math.max(0, Math.floor(max / 2));
  const step = layout.iconSize + layout.gap;
  const fullCount = Math.floor(value / 2);
  const hasHalf = value % 2 === 1;

  for (let index = slots - 1; index >= 0; index -= 1) {
    const line = Math.floor(index / BASE.absorbingPerRow);
    const column = index % BASE.absorbingPerRow;
    const x = left + column * step;
    const y = layout.absorbing.top + (layout.absorbing.rows - 1 - line) * (layout.iconSize + layout.absorbing.rowGap);

    draw(ctx, row.background, x, y, layout.iconSize, layout.iconSize);
    if (index < fullCount) {
      draw(ctx, row.full, x, y, layout.iconSize, layout.iconSize);
    } else if (index === fullCount && hasHalf) {
      draw(ctx, row.half, x, y, layout.iconSize, layout.iconSize);
    }
  }
}

/** 饱和度叠加在饥饿值上，只有满和半两种图标 */
function drawSaturation(
  ctx: CanvasRenderingContext2D,
  full: CanvasImageSource,
  half: CanvasImageSource,
  right: number,
  top: number,
  icon: number,
  gap: number,
  value: number,
  max: number
) {
  const slots = Math.max(0, Math.floor(max / 2));
  const step = icon + gap;
  const fullCount = Math.floor(value / 2);
  const hasHalf = value % 2 === 1;

  for (let index = 0; index < slots; index += 1) {
    const x = right - (index + 1) * step + gap;
    if (index < fullCount) {
      draw(ctx, full, x, top, icon, icon);
    } else if (index === fullCount && hasHalf) {
      draw(ctx, half, x, top, icon, icon);
    }
  }
}

/** 右副手槽贴图水平翻转，保持像素对齐 */
function drawMirrored(
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
  const drawWidth = Math.max(1, right - left);
  const drawHeight = Math.max(1, bottom - top);

  ctx.save();
  ctx.translate(left + drawWidth, top);
  ctx.scale(-1, 1);
  ctx.drawImage(image, 0, 0, drawWidth, drawHeight);
  ctx.restore();
}
