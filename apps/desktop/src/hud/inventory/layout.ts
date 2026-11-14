/** 物品栏布局：容器尺寸、格子位置与命中测试，全部按 MC 像素乘缩放 */

import type { ContainerStyle, SlotCoord } from "@/hud/inventory/styles";
import { isPlayerSlot } from "@/hud/inventory/styles";

export interface SlotBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface InventoryLayout {
  scale: number;
  style: ContainerStyle;
  width: number;
  height: number;
  /** 格子图标边长，16 MC 像素 */
  slotSize: number;
  slots: SlotBox[];
}

export function computeInventoryLayout(scale: number, style: ContainerStyle, imageWidth: number, imageHeight: number): InventoryLayout {
  const slots: SlotBox[] = [];
  for (const coord of style.coords) {
    if (isPlayerSlot(coord.slot_id)) continue;
    slots.push(boxOf(coord, scale));
  }

  return {
    scale,
    style,
    width: imageWidth * scale,
    height: imageHeight * scale,
    slotSize: 16 * scale,
    slots
  };
}

function boxOf(coord: SlotCoord, scale: number): SlotBox {
  return {
    id: coord.slot_id,
    left: coord.x * scale,
    top: coord.y * scale,
    width: coord.width * scale,
    height: coord.height * scale
  };
}

/** 鼠标坐标（画布内）落在哪个格子，未命中返回 null */
export function slotIdAtPoint(layout: InventoryLayout, x: number, y: number): string | null {
  for (const slot of layout.slots) {
    if (x >= slot.left && x < slot.left + slot.width && y >= slot.top && y < slot.top + slot.height) {
      return slot.id;
    }
  }
  return null;
}

export function slotBox(layout: InventoryLayout, slotId: string): SlotBox | undefined {
  return layout.slots.find((slot) => slot.id === slotId);
}
