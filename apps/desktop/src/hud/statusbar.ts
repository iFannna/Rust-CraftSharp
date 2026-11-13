import { loadHudImages, type HudImages } from "./assets";

export interface SlotIcon {
  image: CanvasImageSource;
  smooth: boolean;
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
  selectedSlot: number;
}

const BASE = {
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
  selectionWidth: 24,
  selectionHeight: 23
} as const;

export type StatusBarRenderer = (model: StatusBarModel) => void;

export async function createStatusBarRenderer(canvas: HTMLCanvasElement): Promise<StatusBarRenderer> {
  const images = await loadHudImages();
  return (model) => drawStatusBar(canvas, images, model);
}

function drawStatusBar(canvas: HTMLCanvasElement, images: HudImages, model: StatusBarModel) {
  const s = model.scale;
  const icon = BASE.icon * s;
  const gap = BASE.iconGap * s;
  const verticalGap = BASE.verticalGap * s;
  const coreWidth = BASE.coreWidth * s;
  const hotbarHeight = BASE.hotbarHeight * s;
  const expHeight = BASE.expHeight * s;
  const expMargin = BASE.expMargin * s;

  const leftRows = 3;
  const rightRows = 2;
  const statusRows = Math.max(leftRows, rightRows);
  const statusHeight = statusRows * icon + (statusRows - 1) * verticalGap;
  const width = coreWidth;
  const height = hotbarHeight + expMargin + expHeight + verticalGap + statusHeight;

  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 Canvas 2D 上下文");

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const hotbarY = height - hotbarHeight;
  const expY = hotbarY - expMargin - expHeight;
  const statusBottom = expY - verticalGap;

  const healthY = statusBottom - icon;
  const absorptionY = healthY - verticalGap - icon;
  const armorY = absorptionY - verticalGap - icon;
  const foodY = statusBottom - icon;
  const airY = foodY - verticalGap - icon;

  drawRow(ctx, images.heartContainer, images.heartFull, images.heartHalf, 0, healthY, icon, gap, model.health, model.maxHealth, coreWidth, false);
  drawRow(ctx, images.heartContainer, images.absorbingFull, images.absorbingHalf, 0, absorptionY, icon, gap, model.absorption, model.maxAbsorption, coreWidth, false);
  drawRow(ctx, images.armorEmpty, images.armorFull, images.armorHalf, 0, armorY, icon, gap, model.armor, model.maxArmor, coreWidth, false);
  drawRow(ctx, images.foodEmpty, images.foodFull, images.foodHalf, 0, foodY, icon, gap, model.food, model.maxFood, coreWidth, true);
  drawAirRow(ctx, images.airEmpty, images.air, airY, icon, gap, model.air, model.maxAir, coreWidth);

  draw(ctx, images.expBackground, 0, expY, coreWidth, expHeight);
  const progress = Math.max(0, Math.min(1, model.exp / 100));
  if (progress > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, expY, coreWidth * progress, expHeight);
    ctx.clip();
    draw(ctx, images.expProgress, 0, expY, coreWidth, expHeight);
    ctx.restore();
  }

  draw(ctx, images.hotbar, 0, hotbarY, coreWidth, hotbarHeight);

  if (model.slotIcons) {
    const iconSize = BASE.slot * s;
    const iconTop = hotbarY + BASE.margin * s;

    for (let index = 0; index < 9; index += 1) {
      const icon = model.slotIcons[index];
      if (!icon) continue;

      const iconLeft = (BASE.margin + index * (BASE.slot + BASE.slotSpacing)) * s;
      ctx.imageSmoothingEnabled = icon.smooth;
      draw(ctx, icon.image, iconLeft, iconTop, iconSize, iconSize);
      ctx.imageSmoothingEnabled = false;
    }
  }

  if (model.selectedSlot >= 0 && model.selectedSlot < 9) {
    const columnWidth = (BASE.slot + BASE.slotSpacing) * s;
    const canvasMargin = (BASE.margin - 2) * s;
    const left = canvasMargin + model.selectedSlot * columnWidth + (columnWidth - BASE.selectionWidth * s) / 2;
    const top = hotbarY - s;
    draw(ctx, images.hotbarSelection, left, top, BASE.selectionWidth * s, BASE.selectionHeight * s);
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
