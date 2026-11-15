/** 物品栏交互：hover 蒙版、点击打开、长按拖拽交换、Shift 批量、中键分发、Q 丢弃 */

import { slotIdAtPoint, slotBox, type InventoryLayout, type SlotBox } from "@/hud/inventory/layout";
import type { SlotIcon } from "@/hud/slots/types";
import type { SlotItem } from "@/hud/slots/store";

const LONG_PRESS_MS = 150;
const DRAG_THRESHOLD = 10;
const HOVER_GREEN_MS = 250;
const DOUBLE_CLICK_MS = 500;

export interface InventoryHost {
  layout(): InventoryLayout;
  getItem(slotId: string): SlotItem | undefined;
  getIcon(slotId: string): SlotIcon | null;
  requestRender(): void;
  openSlot(slotId: string): void;
  deleteSlot(slotId: string): void;
  swapSlots(source: string, target: string): void;
  moveToCategory(slotId: string): void;
  distributeTo(slotId: string, path: string): void;
  openMenu(slotId: string, clientX: number, clientY: number): void;
  beginWindowDrag(event: PointerEvent): void;
  hoverEnabled(): boolean;
  clickMode(): "single" | "double";
  dropKey(): string;
  /** 鼠标停在有文件的格子上，box 为格子画布坐标 */
  showTooltip(slotId: string, box: SlotBox): void;
  hideTooltip(): void;
  /** 拖出窗口后交给系统拖放 */
  startFileDrag(slotId: string): void;
}

export interface InventoryDragState {
  source: string;
  target: string;
  x: number;
  y: number;
  icon: SlotIcon | null;
}

export interface InventoryInteractionState {
  hoverSlot: string | null;
  hoverStartedAt: number;
  drag: InventoryDragState | null;
  /** 中键分发：源格保留，浮动图标只是一份副本 */
  distributing: boolean;
}

interface PressState {
  slot: string;
  startX: number;
  startY: number;
  startedAt: number;
  timer: number;
  ready: boolean;
}

interface DistributeState {
  source: string;
  path: string;
  last: string | null;
}

export class InventoryInteraction {
  readonly state: InventoryInteractionState = { hoverSlot: null, hoverStartedAt: 0, drag: null, distributing: false };

  private press: PressState | null = null;
  private hoverTimer = 0;
  private qDown = false;
  private lastDropped: string | null = null;
  private shiftSweeping = false;
  private lastShiftSlot: string | null = null;
  private distribute: DistributeState | null = null;
  private lastClickSlot: string | null = null;
  private lastClickAt = 0;
  /** 当前显示提示的格子，null 表示未显示 */
  private tooltipSlot: string | null = null;
  private disposers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: InventoryHost
  ) {}

  attach(): void {
    const canvas = this.canvas;

    const onPointerDown = (event: PointerEvent) => this.handlePointerDown(event);
    const onPointerMove = (event: PointerEvent) => this.handlePointerMove(event);
    const onPointerUp = (event: PointerEvent) => this.handlePointerUp(event);
    const onPointerCancel = () => this.cancelPress();
    const onPointerLeave = () => {
      this.hideTooltip();
      this.clearHover();
    };
    const onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
    const onKeyUp = (event: KeyboardEvent) => this.handleKeyUp(event);
    const onContextMenu = (event: MouseEvent) => this.handleContextMenu(event);
    // 拦掉中键的自动滚动与 auxclick，否则分发手势会被浏览器默认行为吃掉
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("auxclick", onAuxClick);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    this.disposers = [
      () => canvas.removeEventListener("pointerdown", onPointerDown),
      () => canvas.removeEventListener("pointermove", onPointerMove),
      () => canvas.removeEventListener("pointerup", onPointerUp),
      () => canvas.removeEventListener("pointercancel", onPointerCancel),
      () => canvas.removeEventListener("pointerleave", onPointerLeave),
      () => canvas.removeEventListener("contextmenu", onContextMenu),
      () => canvas.removeEventListener("mousedown", onMouseDown),
      () => canvas.removeEventListener("auxclick", onAuxClick),
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp)
    ];
  }

  destroy(): void {
    this.cancelPress();
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }

  private pointOf(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private hitTest(event: MouseEvent): string | null {
    const point = this.pointOf(event);
    return slotIdAtPoint(this.host.layout(), point.x, point.y);
  }

  private handlePointerDown(event: PointerEvent) {
    if (event.button === 1) {
      event.preventDefault();
      this.beginDistribute(event);
      return;
    }

    if (event.button !== 0) return;

    // 分发期间左键只用于扫格与结束，不再开始新的点击或拖拽
    if (this.distribute) {
      event.preventDefault();
      return;
    }

    const slotId = this.hitTest(event);

    if (!slotId) {
      this.clearHover();
      this.host.beginWindowDrag(event);
      return;
    }

    this.canvas.setPointerCapture(event.pointerId);

    if (event.shiftKey) {
      this.shiftSweeping = true;
      this.lastShiftSlot = null;
      this.sweepShift(slotId);
      return;
    }

    const timer = window.setTimeout(() => {
      if (this.press) this.press.ready = true;
    }, LONG_PRESS_MS);

    this.press = {
      slot: slotId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      timer,
      ready: false
    };
  }

  private handlePointerMove(event: PointerEvent) {
    if (this.distribute) {
      const point = this.pointOf(event);
      this.updateDragIcon(point.x, point.y);
      this.sweepDistribute(event);
      return;
    }

    if (this.shiftSweeping) {
      if (event.buttons & 1) {
        const slotId = this.hitTest(event);
        if (slotId) this.sweepShift(slotId);
      }
      return;
    }

    const press = this.press;

    if (!press && !this.state.drag) {
      this.updateHover(this.hitTest(event));
      return;
    }

    if (this.state.drag) {
      this.updateDrag(event);
      return;
    }

    if (!press) return;

    const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
    // 后台窗口会节流定时器，用按下时间兜底判断长按
    const ready = press.ready || performance.now() - press.startedAt >= LONG_PRESS_MS;

    if (ready) {
      if (distance > DRAG_THRESHOLD) this.startDrag(event);
      return;
    }
  }

  private handlePointerUp(event: PointerEvent) {
    if (this.distribute) {
      // 原版只在左键抬起时结束并补一次落点复制，中键抬起不结束
      if (event.button === 0) {
        this.placeDistribute(event);
        this.endDistribute();
        this.updateHover(this.hitTest(event));
      }
      return;
    }

    if (this.shiftSweeping) {
      this.shiftSweeping = false;
      this.lastShiftSlot = null;
      return;
    }

    if (event.button !== 0) return;

    if (event.pointerId !== undefined && this.canvas.hasPointerCapture?.(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }

    if (this.state.drag) {
      const { source, target } = this.state.drag;
      this.state.drag = null;

      if (target && source !== target) {
        this.host.swapSlots(source, target);
      }

      this.host.requestRender();
      this.press = null;
      this.updateHover(this.hitTest(event));
      return;
    }

    const press = this.press;
    this.press = null;

    if (!press) return;

    window.clearTimeout(press.timer);

    // 移动超过阈值的按下是没进入拖动的拖动，不当作点击
    const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
    if (distance <= DRAG_THRESHOLD) this.handleClick(press.slot);
  }

  private startDrag(event: PointerEvent) {
    const press = this.press;
    if (!press) return;

    window.clearTimeout(press.timer);
    this.hideTooltip();
    this.clearHover();

    this.state.drag = {
      source: press.slot,
      target: press.slot,
      x: 0,
      y: 0,
      icon: this.host.getIcon(press.slot)
    };

    this.updateDrag(event);
  }

  private updateDrag(event: PointerEvent) {
    const drag = this.state.drag;
    if (!drag) return;

    const point = this.pointOf(event);
    if (this.outside(point)) {
      this.dragOut(event.pointerId);
      return;
    }

    drag.x = point.x;
    drag.y = point.y;
    drag.target = this.hitTest(event) ?? drag.source;
    this.host.requestRender();
  }

  /** 离开格子区域就转成系统拖放，不用等鼠标走出整个容器 */
  private outside(point: { x: number; y: number }): boolean {
    const slots = this.host.layout().slots;
    if (slots.length === 0) return false;

    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const slot of slots) {
      left = Math.min(left, slot.left);
      top = Math.min(top, slot.top);
      right = Math.max(right, slot.left + slot.width);
      bottom = Math.max(bottom, slot.top + slot.height);
    }

    const margin = 4;
    return point.x < left - margin || point.y < top - margin || point.x > right + margin || point.y > bottom + margin;
  }

  private dragOut(pointerId: number) {
    const drag = this.state.drag;
    this.state.drag = null;
    this.press = null;

    if (this.canvas.hasPointerCapture?.(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
    this.host.requestRender();

    if (drag) this.host.startFileDrag(drag.source);
  }

  private updateDragIcon(x: number, y: number) {
    const drag = this.state.drag;
    if (!drag) return;
    drag.x = x;
    drag.y = y;
    this.host.requestRender();
  }

  private beginDistribute(event: PointerEvent) {
    // 交换拖拽进行中不接管中键，避免两个手势叠在一起
    if (this.state.drag || this.distribute) return;

    const slotId = this.hitTest(event);
    if (!slotId) return;

    const item = this.host.getItem(slotId);
    if (!item) return;

    // 分发优先，先把可能存在的按下状态清掉
    if (this.press) {
      window.clearTimeout(this.press.timer);
      this.press = null;
    }

    this.distribute = { source: slotId, path: item.path, last: null };
    this.state.distributing = true;
    this.state.drag = { source: slotId, target: slotId, x: 0, y: 0, icon: this.host.getIcon(slotId) };
    this.hideTooltip();
    this.clearHover();

    const point = this.pointOf(event);
    this.updateDragIcon(point.x, point.y);
    this.canvas.setPointerCapture(event.pointerId);
  }

  /** 左键抬起时若停在空格子上，再复制一份；和按住扫过的路径共用去重规则 */
  private placeDistribute(event: PointerEvent) {
    const distribute = this.distribute;
    if (!distribute) return;

    const slotId = this.hitTest(event);
    if (!slotId || slotId === distribute.source) return;
    if (this.host.getItem(slotId)) return;

    this.host.distributeTo(slotId, distribute.path);
  }

  private endDistribute() {
    this.distribute = null;
    this.state.drag = null;
    this.state.distributing = false;
    this.host.requestRender();
  }

  private sweepDistribute(event: PointerEvent) {
    const distribute = this.distribute;
    if (!distribute || !(event.buttons & 1)) return;

    const slotId = this.hitTest(event);
    if (!slotId || slotId === distribute.source || slotId === distribute.last) return;

    this.host.distributeTo(slotId, distribute.path);
    distribute.last = slotId;
  }

  private sweepShift(slotId: string) {
    if (slotId === this.lastShiftSlot) return;
    this.lastShiftSlot = slotId;
    this.host.moveToCategory(slotId);
  }

  private cancelPress() {
    if (this.press) {
      window.clearTimeout(this.press.timer);
      this.press = null;
    }

    this.hideTooltip();

    if (this.state.drag || this.distribute || this.shiftSweeping) {
      this.state.drag = null;
      this.state.distributing = false;
      this.distribute = null;
      this.shiftSweeping = false;
      this.host.requestRender();
    }
  }

  private updateHover(slotId: string | null) {
    if (!this.host.hoverEnabled()) {
      // hover 蒙版关闭时提示仍跟随鼠标
      if (this.qDown && slotId && slotId !== this.lastDropped) {
        const item = this.host.getItem(slotId);
        if (item) this.host.deleteSlot(slotId);
        this.lastDropped = slotId;
      }
      this.syncTooltip(slotId);
      this.clearHover();
      return;
    }

    if (this.qDown && slotId && slotId !== this.lastDropped) {
      const item = this.host.getItem(slotId);
      if (item) this.host.deleteSlot(slotId);
      this.lastDropped = slotId;
    }

    this.syncTooltip(slotId);

    if (slotId === this.state.hoverSlot) return;

    window.clearTimeout(this.hoverTimer);
    this.state.hoverSlot = slotId;
    this.state.hoverStartedAt = performance.now();

    if (slotId && this.host.getItem(slotId)) {
      // 窗口失焦或后台时定时器会被节流，渲染时再按时间戳兜底判断
      this.hoverTimer = window.setTimeout(() => this.host.requestRender(), HOVER_GREEN_MS);
    }

    this.host.requestRender();
  }

  /** 有文件的格子停留 250ms 后转绿色，失焦被节流时按时间戳判断 */
  hoverPhase(): "white" | "green" {
    const slotId = this.state.hoverSlot;
    if (!slotId || !this.host.getItem(slotId)) return "white";
    return performance.now() - this.state.hoverStartedAt >= HOVER_GREEN_MS ? "green" : "white";
  }

  private clearHover() {
    window.clearTimeout(this.hoverTimer);
    if (!this.state.hoverSlot) return;
    this.state.hoverSlot = null;
    this.host.requestRender();
  }

  /** 只在格子切换时发送提示，空格与无文件格子一律隐藏 */
  private syncTooltip(slotId: string | null) {
    if (slotId === this.tooltipSlot) return;

    if (!slotId || !this.host.getItem(slotId)) {
      this.hideTooltip();
      return;
    }

    const box = slotBox(this.host.layout(), slotId);
    if (!box) {
      this.hideTooltip();
      return;
    }

    this.tooltipSlot = slotId;
    this.host.showTooltip(slotId, box);
  }

  private hideTooltip() {
    if (!this.tooltipSlot) return;
    this.tooltipSlot = null;
    this.host.hideTooltip();
  }

  /** 格子内容变化（粘贴、拖入、清空）后刷新当前提示 */
  refreshTooltip() {
    const slotId = this.tooltipSlot;
    if (!slotId) return;

    const box = slotBox(this.host.layout(), slotId);
    if (!box || !this.host.getItem(slotId)) {
      this.hideTooltip();
      return;
    }

    this.host.showTooltip(slotId, box);
  }

  private handleClick(slotId: string) {
    const item = this.host.getItem(slotId);
    if (!item) return;

    if (this.host.clickMode() === "single") {
      this.host.openSlot(slotId);
      return;
    }

    const now = performance.now();
    const isDouble = this.lastClickSlot === slotId && now - this.lastClickAt < DOUBLE_CLICK_MS;

    if (isDouble) {
      this.lastClickSlot = null;
      this.lastClickAt = 0;
      this.host.openSlot(slotId);
      return;
    }

    this.lastClickSlot = slotId;
    this.lastClickAt = now;
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    if (event.key.toLowerCase() !== this.host.dropKey().toLowerCase()) return;

    event.preventDefault();
    if (!this.qDown) {
      this.qDown = true;
      this.lastDropped = null;
    }

    const slotId = this.state.hoverSlot;
    if (slotId && slotId !== this.lastDropped) {
      const item = this.host.getItem(slotId);
      if (item) {
        this.host.deleteSlot(slotId);
        this.hideTooltip();
      }
      this.lastDropped = slotId;
    }
  }

  private handleKeyUp(event: KeyboardEvent) {
    if (event.key.toLowerCase() !== this.host.dropKey().toLowerCase()) return;
    this.qDown = false;
    this.lastDropped = null;
  }

  private handleContextMenu(event: MouseEvent) {
    // 分发期间右键被吞掉，和原版一致
    if (this.distribute) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const slotId = this.hitTest(event);
    if (!slotId) return;

    event.preventDefault();
    event.stopPropagation();
    this.host.openMenu(slotId, event.clientX, event.clientY);
  }
}

/** 供外部取格子矩形，拖动图标居中与菜单定位共用 */
export function slotAnchor(layout: InventoryLayout, slotId: string): SlotBox | undefined {
  return slotBox(layout, slotId);
}
