import { useEffect, useRef, useState } from "react";
import { getConfig, updateConfig, type BossBarConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { bossBarNotchProgress, bossBarProgress } from "@/hud/bossbar/bossBarAssets";
import { tOf } from "@/i18n";
import { openDialogWindow } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { GripIcon } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";
import { Button } from "@/settings/components/controls";
import { readDragRows, reorderAtPointer } from "@/settings/components/reorder";

const LINK = "flex-none rounded-sm px-1 text-xs text-muted-foreground transition-colors hover:text-foreground";

export function BossBarCardContent() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const bars = config.bossBars;

  const [order, setOrder] = useState<BossBarConfig[]>(bars);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const orderRef = useRef(order);
  const dragIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: () => void;
    cancel: () => void;
  } | null>(null);

  useEffect(() => {
    if (draggingId) return;
    setOrder(bars);
  }, [bars, draggingId]);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const patch = (id: string, next: Partial<BossBarConfig>) => {
    updateConfig({ bossBars: bars.map((bar) => (bar.id === id ? { ...bar, ...next } : bar)) });
  };

  const openEditor = async (id?: string) => {
    const saved = await openDialogWindow<BossBarConfig>({
      label: WINDOW_LABEL.bossBarEditor,
      title: t("bossBar.editorTitle"),
      page: "boss-bar-editor",
      params: id ? { id } : {},
      width: 360,
      height: 460,
      anchor: WINDOW_LABEL.settings
    });
    if (!saved) return;

    const current = getConfig().bossBars;
    updateConfig({
      bossBars: id ? current.map((bar) => (bar.id === id ? saved : bar)) : [...current, saved]
    });
  };

  const detachDrag = () => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    window.removeEventListener("pointercancel", listeners.cancel);
    listenersRef.current = null;
  };

  const cancelDrag = () => {
    detachDrag();
    dragIdRef.current = null;
    setDraggingId(null);
    orderRef.current = getConfig().bossBars;
    setOrder(getConfig().bossBars);
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

  const moveDragTo = (clientY: number) => {
    const id = dragIdRef.current;
    if (!id) return;
    const rows = readDragRows(listRef.current, "[data-bar-id]", "data-bar-id");
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
    updateConfig({ bossBars: orderRef.current });
  };

  const startDrag = (id: string, element: HTMLElement, pointerId: number) => {
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

  return (
    <>
      <div ref={listRef} className={cn("mb-3 flex flex-col gap-2", draggingId && "select-none")}>
        {order.map((bar) => (
          <div
            key={bar.id}
            data-bar-id={bar.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5",
              draggingId === bar.id && "relative z-10 bg-accent/60 opacity-80"
            )}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const target = event.target as HTMLElement;
              if (target.closest("button, input, [role='switch'], a")) return;
              event.preventDefault();
              startDrag(bar.id, event.currentTarget, event.pointerId);
            }}
          >
            <button
              type="button"
              className="grid h-8 w-8 flex-none touch-none cursor-grab place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent active:cursor-grabbing"
              aria-label={t("aria.dragHandle")}
              title={t("aria.dragHandle")}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                startDrag(bar.id, event.currentTarget, event.pointerId);
              }}
            >
              <GripIcon size={16} />
            </button>

            <div className="relative h-[10px] w-[364px] flex-none overflow-hidden">
              <img
                src={bossBarProgress(bar.color)}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-contain [image-rendering:pixelated]"
              />
              {bar.notch ? (
                <img
                  src={bossBarNotchProgress(bar.notch)}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-contain [image-rendering:pixelated]"
                />
              ) : null}
            </div>

            <span className="min-w-0 flex-1 truncate text-sm font-medium">{bar.name}</span>

            <button type="button" className={LINK} onClick={() => void openEditor(bar.id)}>
              {t("bossBar.edit")}
            </button>
            <button
              type="button"
              className={LINK}
              onClick={() => patch(bar.id, { enabled: !bar.enabled })}
            >
              {bar.enabled ? t("bossBar.disable") : t("bossBar.enable")}
            </button>
            <button
              type="button"
              className={cn(LINK, "hover:text-destructive")}
              onClick={() => updateConfig({ bossBars: bars.filter((item) => item.id !== bar.id) })}
            >
              {t("bossBar.delete")}
            </button>
          </div>
        ))}
      </div>

      <Button className="w-full" onClick={() => void openEditor()}>
        {t("bossBar.add")}
      </Button>
    </>
  );
}
