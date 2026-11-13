import { loadHudImages, type HudImages } from "./assets";
import { BASE, computeLayout, selectionRect, slotIconRect } from "./layout";

export interface SlotIcon {
  image: CanvasImageSource;
  smooth: boolean;
}

export interface DragIcon {
  icon: SlotIcon;
  /** 画布内坐标，图标中心 */
  x: number;
  y: number;
}

export interface StatusBarModel {
  scale: number;
  slotIcons?: Array<SlotIcon | null>;
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
  const layout = computeLayout(model.scale);
  const { coreWidth, hotbarTop, hotbarHeight, expTop, expHeight, healthTop, absorptionTop, armorTop, foodTop, airTop, iconSize, gap } = layout;

  canvas.width = Math.ceil(layout.width);
  canvas.height = Math.ceil(layout.height);
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 Canvas 2D 上下文");

  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawRow(ctx, images.heartContainer, images.heartFull, images.heartHalf, 0, healthTop, iconSize, gap, model.health, model.maxHealth, coreWidth, false);
  drawRow(ctx, images.heartContainer, images.absorbingFull, images.absorbingHalf, 0, absorptionTop, iconSize, gap, model.absorption, model.maxAbsorption, coreWidth, false);
  drawRow(ctx, images.armorEmpty, images.armorFull, images.armorHalf, 0, armorTop, iconSize, gap, model.armor, model.maxArmor, coreWidth, false);
  drawRow(ctx, images.foodEmpty, images.foodFull, images.foodHalf, 0, foodTop, iconSize, gap, model.food, model.maxFood, coreWidth, true);
  drawAirRow(ctx, images.airEmpty, images.air, airTop, iconSize, gap, model.air, model.maxAir, coreWidth);

  draw(ctx, images.expBackground, 0, expTop, coreWidth, expHeight);
  const progress = Math.max(0, Math.min(1, model.exp / 100));
  if (progress > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, expTop, coreWidth * progress, expHeight);
    ctx.clip();
    draw(ctx, images.expProgress, 0, expTop, coreWidth, expHeight);
    ctx.restore();
  }

  draw(ctx, images.hotbar, 0, hotbarTop, coreWidth, hotbarHeight);

  if (model.slotIcons) {
    for (let index = 0; index < 9; index += 1) {
      const slot = model.slotIcons[index];
      if (!slot) continue;
      if (model.drag && model.dragSourceSlot === index + 2) continue;

      const rect = slotIconRect(layout, index);
      ctx.imageSmoothingEnabled = slot.smooth;
      ctx.imageSmoothingQuality = slot.smooth ? "high" : "low";
      if (model.dimmedSlot === index + 2) ctx.globalAlpha = 0.5;
      draw(ctx, slot.image, rect.left, rect.top, rect.width, rect.height);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
    }
  }

  const selectionSlot = model.selectedSlot >= 2 ? model.selectedSlot : model.hoverSlot ?? -1;
  if (selectionSlot >= 2 && selectionSlot <= 10) {
    const rect = selectionRect(layout, selectionSlot - 2);
    draw(ctx, images.hotbarSelection, rect.left, rect.top, rect.width, rect.height);
  }

  if (model.drag) {
    const size = BASE.slot * model.scale;
    ctx.imageSmoothingEnabled = model.drag.icon.smooth;
    ctx.imageSmoothingQuality = model.drag.icon.smooth ? "high" : "low";
    draw(ctx, model.drag.icon.image, model.drag.x - size / 2, model.drag.y - size / 2, size, size);
    ctx.imageSmoothingEnabled = false;
  }
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  background: CanvasImageSource,
  full: CanvasImageSource,
  half: CanvasImageSource,
  left: number,
  top: number,
  icon: number,
  gap: number,
  value: number,
  max: number,
  coreWidth: number,
  rightAligned: boolean
) {
  const slots = Math.max(0, Math.floor(max / 2));
  const fullCount = Math.floor(value / 2);
  const hasHalf = value % 2 === 1;
  const step = icon + gap;

  for (let index = 0; index < slots; index += 1) {
    const x = rightAligned
      ? coreWidth - (index + 1) * step + gap
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
  top: number,
  icon: number,
  gap: number,
  value: number,
  max: number,
  coreWidth: number
) {
  const slots = Math.max(0, Math.floor(max / 2));
  const fullCount = Math.floor(value / 2);
  const step = icon + gap;

  for (let index = 0; index < slots; index += 1) {
    const x = coreWidth - (index + 1) * step + gap;
    if (index < fullCount) {
      draw(ctx, full, x, top, icon, icon);
    } else {
      draw(ctx, empty, x, top, icon, icon);
    }
  }
}

function draw(
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
