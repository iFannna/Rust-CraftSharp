import { slotIndexAtPoint, type StatusBarLayout } from "./layout";
import type { SlotIcon } from "./statusbar";
import type { SlotItem } from "./slotStore";

/** 长按判定 150ms，移动阈值 10 像素，与原 WPF 一致 */
const LONG_PRESS_MS = 150;
const DRAG_THRESHOLD = 10;

export interface HotbarHost {
  layout(): StatusBarLayout;
  getItem(globalIndex: number): SlotItem | undefined;
  getIcon(globalIndex: number): SlotIcon | null;
  requestRender(): void;
  openSlot(globalIndex: number): void;
  dropSlot(globalIndex: number): void;
  swapSlots(source: number, target: number): void;
  openMenu(globalIndex: number, clientX: number, clientY: number): void;
  showFileName(item: SlotItem | null): void;
  clickMode(): "single" | "double";
  hoverEnabled(): boolean;
}

export interface DragState {
  source: number;
  target: number;
  x: number;
  y: number;
  icon: SlotIcon | null;
}

export interface HotbarState {
  selected: number;
  hover: number;
  drag: DragState | null;
}

interface PressState {
  slot: number;
  startX: number;
  startY: number;
  timer: number;
  ready: boolean;
  cancelled: boolean;
}

export class HotbarInteraction {
  readonly state: HotbarState = { selected: -1, hover: -1, drag: null };

  private press: PressState | null = null;
  private disposers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HotbarHost
  ) {}

  attach(): void {
    const canvas = this.canvas;

    const onPointerDown = (event: PointerEvent) => this.handlePointerDown(event);
    const onPointerMove = (event: PointerEvent) => this.handlePointerMove(event);
    const onPointerUp = (event: PointerEvent) => this.handlePointerUp(event);
    const onPointerCancel = () => this.cancelPress();
    const onWheel = (event: WheelEvent) => this.handleWheel(event);
    const onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
    const onContextMenu = (event: MouseEvent) => this.handleContextMenu(event);

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("contextmenu", onContextMenu);

    this.disposers = [
      () => canvas.removeEventListener("pointerdown", onPointerDown),
      () => canvas.removeEventListener("pointermove", onPointerMove),
      () => canvas.removeEventListener("pointerup", onPointerUp),
      () => canvas.removeEventListener("pointercancel", onPointerCancel),
      () => canvas.removeEventListener("wheel", onWheel),
      () => window.removeEventListener("keydown", onKeyDown),
      () => canvas.removeEventListener("contextmenu", onContextMenu)
    ];
  }

  destroy(): void {
    this.cancelPress();
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }

  private hitTest(event: MouseEvent): number {
    const rect = this.canvas.getBoundingClientRect();
    return slotIndexAtPoint(this.host.layout(), event.clientX - rect.left, event.clientY - rect.top);
  }

  private handlePointerDown(event: PointerEvent) {
    if (event.button !== 0) return;

    const slot = this.hitTest(event);

    if (slot < 0) {
      this.select(-1);
      return;
    }

    this.canvas.setPointerCapture(event.pointerId);

    const timer = window.setTimeout(() => {
      if (this.press) {
        this.press.ready = true;
      }
    }, LONG_PRESS_MS);

    this.press = {
      slot,
      startX: event.clientX,
      startY: event.clientY,
      timer,
      ready: false,
      cancelled: false
    };
  }

  private handlePointerMove(event: PointerEvent) {
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

    if (press.ready) {
      if (distance > DRAG_THRESHOLD) this.startDrag(event);
      return;
    }

    if (distance > DRAG_THRESHOLD) {
      window.clearTimeout(press.timer);
      press.cancelled = true;
    }
  }

  private handlePointerUp(event: PointerEvent) {
    if (event.button !== 0) return;

    if (event.pointerId !== undefined && this.canvas.hasPointerCapture?.(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }

    if (this.state.drag) {
      const { source, target } = this.state.drag;
      this.state.drag = null;

      if (target >= 2 && source !== target) {
        this.host.swapSlots(source, target);
      }

      this.host.requestRender();
      this.press = null;
      return;
    }

    const press = this.press;
    this.press = null;

    if (!press) return;

    window.clearTimeout(press.timer);
    this.handleClick(press.slot);
  }

  private startDrag(event: PointerEvent) {
    const press = this.press;
    if (!press) return;

    window.clearTimeout(press.timer);

    this.state.drag = {
      source: press.slot,
      target: press.slot,
      x: event.clientX,
      y: event.clientY,
      icon: this.host.getIcon(press.slot)
    };

    this.state.selected = -1;
    this.state.hover = -1;
    this.host.showFileName(null);
    this.updateDrag(event);
  }

  private updateDrag(event: PointerEvent) {
    const drag = this.state.drag;
    if (!drag) return;

    const rect = this.canvas.getBoundingClientRect();
    drag.x = event.clientX - rect.left;
    drag.y = event.clientY - rect.top;
    drag.target = this.hitTest(event);
    this.host.requestRender();
  }

  private cancelPress() {
    if (this.press) {
      window.clearTimeout(this.press.timer);
      this.press = null;
    }

    if (this.state.drag) {
      this.state.drag = null;
      this.host.requestRender();
    }
  }

  private updateHover(slot: number) {
    if (!this.host.hoverEnabled()) {
      if (this.state.hover !== -1) {
        this.state.hover = -1;
        this.host.requestRender();
      }
      return;
    }

    const visible = slot >= 2 && (this.state.selected === -1 || this.state.selected === slot);
    const next = visible ? slot : -1;

    if (next !== this.state.hover) {
      this.state.hover = next;
      this.host.requestRender();
    }
  }

  private handleClick(slot: number) {
    const item = this.host.getItem(slot);

    if (this.host.clickMode() === "single") {
      if (!item) return;
      this.host.openSlot(slot);
      return;
    }

    if (this.state.selected === slot) {
      if (!item) {
        this.select(-1);
        return;
      }
      this.host.openSlot(slot);
      this.select(-1);
      return;
    }

    this.select(slot);
  }

  private handleWheel(event: WheelEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (this.state.selected < 2) {
      this.select(2);
      return;
    }

    const current = this.state.selected;
    const next = event.deltaY < 0
      ? (current === 2 ? 10 : current - 1)
      : (current === 10 ? 2 : current + 1);

    this.select(next);
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    if (/^[1-9]$/.test(event.key)) {
      this.select(Number(event.key) + 1);
      event.preventDefault();
      return;
    }

    if (event.key === "Enter") {
      const selected = this.state.selected;
      if (selected < 2) return;

      event.preventDefault();
      const item = this.host.getItem(selected);
      if (!item) {
        this.select(-1);
        return;
      }

      this.host.openSlot(selected);
      this.select(-1);
      return;
    }

    if (event.key === "q" || event.key === "Q") {
      if (this.state.selected < 2) return;
      event.preventDefault();
      this.host.dropSlot(this.state.selected);
    }
  }

  private handleContextMenu(event: MouseEvent) {
    const slot = this.hitTest(event);
    if (slot < 0) return;

    event.preventDefault();
    event.stopPropagation();
    this.host.openMenu(slot, event.clientX, event.clientY);
  }

  private select(slot: number): void {
    this.state.selected = slot;

    if (slot >= 2) {
      this.state.hover = -1;
      this.host.showFileName(this.host.getItem(slot) ?? null);
    } else {
      this.host.showFileName(null);
    }

    this.host.requestRender();
  }
}
