import { useEffect, useRef, useState } from "react";
import { getConfig, updateConfig, type BossBarConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { bossBarNotchProgress, bossBarProgress } from "@/hud/bossbar/bossBarAssets";
import { tOf } from "@/i18n";
import { openDialogWindow } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { GripIcon } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";
import { Button, Note } from "@/settings/components/controls";

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

  useEffect(() => {
    setOrder(bars);
  }, [bars]);

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

  const cancelDrag = () => {
    dragIdRef.current = null;
    setDraggingId(null);
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

  const startDrag = (id: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragIdRef.current = id;
    setDraggingId(id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const id = dragIdRef.current;
    if (!id || !listRef.current) return;

    const rows = [...listRef.current.querySelectorAll<HTMLElement>("[data-bar-id]")];
    const targetIndex = rows.findIndex((row) => event.clientY < row.getBoundingClientRect().bottom);
    const to = targetIndex === -1 ? rows.length - 1 : targetIndex;

    setOrder((current) => {
      const from = current.findIndex((bar) => bar.id === id);
      if (from === -1 || from === to) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const endDrag = () => {
    if (!dragIdRef.current) return;
    dragIdRef.current = null;
    setDraggingId(null);
    updateConfig({ bossBars: orderRef.current });
  };

  return (
    <>
      {bars.length === 0 ? <Note>{t("bossBar.empty")}</Note> : null}

      <div ref={listRef} className="mb-3 flex flex-col gap-2">
        {order.map((bar) => (
          <div
            key={bar.id}
            data-bar-id={bar.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5",
              draggingId === bar.id && "opacity-60"
            )}
          >
            <button
              type="button"
              className="grid h-8 w-8 flex-none cursor-grab place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent active:cursor-grabbing"
              aria-label={t("aria.dragHandle")}
              onPointerDown={startDrag(bar.id)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={cancelDrag}
              onLostPointerCapture={endDrag}
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

            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {bar.name.trim() || t("bossBar.untitled")}
            </span>

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
