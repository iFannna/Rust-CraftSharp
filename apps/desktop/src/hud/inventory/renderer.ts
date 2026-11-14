/** 物品栏画布渲染：容器背景、格子图标、hover 蒙版、拖动图标 */

import { draw, drawUniform } from "@/hud/shared/canvas";
import type { InventoryLayout } from "@/hud/inventory/layout";
import type { SlotIcon } from "@/hud/statusbar/renderer";

export type HoverPhase = "white" | "green";

export interface InventoryDrag {
  icon: SlotIcon;
  /** 画布内坐标，图标中心 */
  x: number;
  y: number;
}

export interface InventoryModel {
  layout: InventoryLayout;
  background: CanvasImageSource;
  /** 按 slot_id 索引，null 表示空格 */
  icons: ReadonlyMap<string, SlotIcon | null>;
  hoverSlot: string | null;
  hoverPhase: HoverPhase;
  drag: InventoryDrag | null;
  dragSourceSlot: string | null;
  /** 剪切态格子，图标半透明 */
  dimmedSlot: string | null;
}

/** 与原 WPF 一致：hover 白色 50%，停留后转绿色 44% */
const WHITE_OVERLAY = "rgba(255, 255, 255, 0.5)";
const GREEN_OVERLAY = "rgba(75, 255, 84, 0.44)";

export function drawInventory(canvas: HTMLCanvasElement, model: InventoryModel) {
  const { layout } = model;

  canvas.width = Math.ceil(layout.width);
  canvas.height = Math.ceil(layout.height);
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 Canvas 2D 上下文");

  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  draw(ctx, model.background, 0, 0, layout.width, layout.height);

  for (const slot of layout.slots) {
    const icon = model.icons.get(slot.id);
    if (!icon) continue;
    if (model.drag && model.dragSourceSlot === slot.id) continue;

    ctx.imageSmoothingEnabled = icon.smooth;
    ctx.imageSmoothingQuality = icon.smooth ? "high" : "low";
    if (model.dimmedSlot === slot.id) ctx.globalAlpha = 0.5;
    drawUniform(ctx, icon.image, slot.left, slot.top, slot.width, slot.height);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
  }

  if (model.hoverSlot) {
    const slot = layout.slots.find((candidate) => candidate.id === model.hoverSlot);
    if (slot) {
      ctx.fillStyle = model.hoverPhase === "green" ? GREEN_OVERLAY : WHITE_OVERLAY;
      ctx.fillRect(Math.round(slot.left), Math.round(slot.top), Math.round(slot.width), Math.round(slot.height));
    }
  }

  if (model.drag) {
    const size = layout.slotSize;
    ctx.imageSmoothingEnabled = model.drag.icon.smooth;
    ctx.imageSmoothingQuality = model.drag.icon.smooth ? "high" : "low";
    drawUniform(ctx, model.drag.icon.image, model.drag.x - size / 2, model.drag.y - size / 2, size, size);
    ctx.imageSmoothingEnabled = false;
  }
}
