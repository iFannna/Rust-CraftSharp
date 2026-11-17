import { useEffect, useRef, useState } from "react";
import { updateConfig, getConfig, type TrayMenuItemConfig, type TrayMenuItemId } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { trayItemLabel } from "@/lib/trayLabels";
import { Row, Select, Toggle } from "@/settings/components/controls";
import { readDragRows, reorderAtPointer } from "@/settings/components/reorder";
import { trayActionOptions } from "@/settings/options";
import { GripIcon } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";

const CLICK_ROWS = [
  { key: "single", label: "tray.singleClick", desc: "tray.singleClickDesc" },
  { key: "double", label: "tray.doubleClick", desc: "tray.doubleClickDesc" },
  { key: "middle", label: "tray.middleClick", desc: "tray.middleClickDesc" },
  { key: "right", label: "tray.rightClick", desc: "tray.rightClickDesc" }
] as const;

export function TrayControls() {
  const config = useAppConfig();
  const t = tOf(config.system.language);

  return (
    <>
      {CLICK_ROWS.map(({ key, label, desc }) => (
        <Row key={key} label={t(label)} description={t(desc)}>
          <Select
            value={config.tray.clicks[key]}
            options={trayActionOptions(t)}
            ariaLabel={t(label)}
            wide
            onChange={(action) =>
              updateConfig({ tray: { clicks: { ...config.tray.clicks, [key]: action } } })
            }
          />
        </Row>
      ))}
      <TrayMenuEditor />
    </>
  );
}

function TrayMenuEditor() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [order, setOrder] = useState<TrayMenuItemConfig[]>(config.tray.menu);
  const [draggingId, setDraggingId] = useState<TrayMenuItemId | null>(null);
  const orderRef = useRef(order);
  const dragIdRef = useRef<TrayMenuItemId | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: () => void;
    cancel: () => void;
  } | null>(null);

  useEffect(() => {
    if (draggingId) return;
    setOrder(config.tray.menu);
  }, [config.tray.menu, draggingId]);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const persist = (next: TrayMenuItemConfig[]) => {
    orderRef.current = next;
    setOrder(next);
    updateConfig({ tray: { menu: next } });
  };

  const setVisible = (id: TrayMenuItemId, visible: boolean) => {
    persist(orderRef.current.map((item) => (item.id === id ? { ...item, visible } : item)));
  };

  const moveBy = (id: TrayMenuItemId, delta: number) => {
    const current = orderRef.current;
    const from = current.findIndex((item) => item.id === id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persist(next);
  };

  const detachDrag = () => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    window.removeEventListener("pointercancel", listeners.cancel);
    listenersRef.current = null;
  };

  const moveDragTo = (clientY: number) => {
    const id = dragIdRef.current;
    if (!id) return;
    const rows = readDragRows(listRef.current, "[data-menu-id]", "data-menu-id");
    const next = reorderAtPointer(orderRef.current, id, clientY, rows);
    if (next === orderRef.current) return;
    orderRef.current = next;
    setOrder(next);
  };

  const endDrag = () => {
    detachDrag();
    if (!dragIdRef.current) return;
    dragIdRef.current = null;
    setDraggingId(null);
    updateConfig({ tray: { menu: orderRef.current } });
  };

  const cancelDrag = () => {
    detachDrag();
    dragIdRef.current = null;
    setDraggingId(null);
    orderRef.current = getConfig().tray.menu;
    setOrder(getConfig().tray.menu);
  };

  const startDrag = (id: TrayMenuItemId, element: HTMLElement, pointerId: number) => {
    if (dragIdRef.current) return;
    dragIdRef.current = id;
    setDraggingId(id);
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // 捕获失败时仍靠 window 监听完成拖拽
    }
    const listeners = {
      move: (event: PointerEvent) => moveDragTo(event.clientY),
      up: () => endDrag(),
      cancel: () => cancelDrag()
    };
    listenersRef.current = listeners;
    window.addEventListener("pointermove", listeners.move);
    window.addEventListener("pointerup", listeners.up);
    window.addEventListener("pointercancel", listeners.cancel);
  };

  useEffect(() => {
    if (!draggingId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelDrag();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draggingId]);

  useEffect(() => () => detachDrag(), []);

  return (
    <div className="mb-2 rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-medium">{t("tray.menuTitle")}</div>
        <div className="mt-1 text-xs leading-snug text-muted-foreground">{t("tray.menuHint")}</div>
      </div>
      <div ref={listRef} className={cn(draggingId && "select-none")}>
        {order.map((item) => {
          const label = trayItemLabel(t, item.id);
          return (
            <div
              key={item.id}
              data-menu-id={item.id}
              className={cn(
                "flex items-center gap-3 border-b px-4 py-2.5",
                draggingId === item.id && "relative z-10 bg-accent/60 opacity-80"
              )}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const target = event.target as HTMLElement;
                if (target.closest("button, input, [role='switch'], a")) return;
                event.preventDefault();
                startDrag(item.id, event.currentTarget, event.pointerId);
              }}
            >
              <button
                type="button"
                className={cn(
                  "grid h-8 w-8 flex-none touch-none cursor-grab place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent active:cursor-grabbing",
                  !item.visible && "opacity-50"
                )}
                aria-label={t("aria.dragHandle")}
                title={t("aria.dragHandle")}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  startDrag(item.id, event.currentTarget, event.pointerId);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  moveBy(item.id, event.key === "ArrowUp" ? -1 : 1);
                }}
              >
                <GripIcon size={16} />
              </button>
              <div
                className={cn(
                  "min-w-0 flex-1 text-sm font-medium",
                  !item.visible && "opacity-50"
                )}
              >
                {label}
              </div>
              <Toggle
                checked={item.visible}
                label={label}
                onChange={(visible) => setVisible(item.id, visible)}
              />
            </div>
          );
        })}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            disabled
            className="grid h-8 w-8 flex-none cursor-default place-items-center rounded-sm text-muted-foreground opacity-40"
            aria-label={t("aria.dragHandle")}
          >
            <GripIcon size={16} />
          </button>
          <div className="min-w-0 flex-1 text-sm font-medium text-muted-foreground/70">
            {t("tray.itemExit")}
          </div>
          <Toggle checked disabled label={t("tray.itemExit")} onChange={() => undefined} />
        </div>
      </div>
    </div>
  );
}
