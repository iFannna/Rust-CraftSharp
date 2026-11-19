/** 壁纸查看器：窗口内翻页、缩放拖拽与下载，列表与窗口生命周期由入口负责 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/components/button";
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon, WarningIcon } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";
import type { TFunction } from "@/i18n";
import type { WallpaperItem } from "./api";

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const FIT_INDEX = 3;

interface WallpaperViewerProps {
  item: WallpaperItem;
  index: number;
  total: number;
  saving: boolean;
  t: TFunction;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDownload: () => void;
  onApply: () => void;
}

export function WallpaperViewer({
  item,
  index,
  total,
  saving,
  t,
  onClose,
  onPrev,
  onNext,
  onDownload,
  onApply
}: WallpaperViewerProps) {
  const [zoomIndex, setZoomIndex] = useState(FIT_INDEX);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const zoom = ZOOM_LEVELS[zoomIndex];
  const dynamic = item.kind === "dynamic";

  useEffect(() => {
    setZoomIndex(FIT_INDEX);
    setOffset({ x: 0, y: 0 });
    setStatus("loading");
  }, [item.id]);

  useEffect(() => {
    if (zoom <= 1) setOffset({ x: 0, y: 0 });
  }, [zoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoomIndex((current) =>
        Math.min(ZOOM_LEVELS.length - 1, Math.max(0, current + (event.deltaY < 0 ? 1 : -1)))
      );
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        onPrev();
      }
      if (event.key === "ArrowRight" && index < total - 1) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, total, onClose, onPrev, onNext]);

  const resetView = () => {
    setZoomIndex(FIT_INDEX);
    setOffset({ x: 0, y: 0 });
  };

  const zoomBy = (step: number) =>
    setZoomIndex((current) => Math.min(ZOOM_LEVELS.length - 1, Math.max(0, current + step)));

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const iconButton = "h-7 w-7";

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={stageRef}
          className={cn(
            "relative min-h-0 flex-1 select-none overflow-hidden",
            zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default"
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={resetView}
        >
          <div className="absolute inset-0 grid place-items-center p-6">
            <img
              src={item.previewUrl}
              alt=""
              draggable={false}
              onLoad={() => setStatus("ready")}
              onError={() => setStatus("error")}
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
              className={cn(
                "max-h-full max-w-full object-contain shadow-sm transition-opacity",
                status === "ready" ? "opacity-100" : "opacity-0"
              )}
            />
          </div>

          {status === "loading" ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="size-7 animate-spin rounded-full border-2 border-muted border-t-primary" />
            </div>
          ) : null}

          {status === "error" ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="flex items-center gap-2 rounded-md border bg-background/90 px-3 py-1.5 text-sm text-muted-foreground">
                <WarningIcon className="size-4" />
                {t("wallpaper.imageFailed")}
              </span>
            </div>
          ) : null}
        </div>

        <footer className="flex h-12 flex-none items-center justify-center gap-1 border-t px-4">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={iconButton}
            disabled={index <= 0}
            aria-label={t("wallpaper.prevImage")}
            onClick={onPrev}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-[64px] text-center text-xs tabular-nums text-muted-foreground">
            {Math.max(index, 0) + 1} / {total}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={iconButton}
            disabled={index >= total - 1}
            aria-label={t("wallpaper.nextImage")}
            onClick={onNext}
          >
            <ChevronRightIcon />
          </Button>

          <span className="mx-2 h-4 w-px bg-border" aria-hidden="true" />

          <Button
            type="button"
            variant="outline"
            size="icon"
            className={iconButton}
            disabled={zoomIndex <= 0}
            aria-label={t("wallpaper.zoomOut")}
            onClick={() => zoomBy(-1)}
          >
            <MinusIcon />
          </Button>
          <span className="w-12 select-none text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={iconButton}
            disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
            aria-label={t("wallpaper.zoomIn")}
            onClick={() => zoomBy(1)}
          >
            <PlusIcon />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={resetView}>
            {t("wallpaper.fit")}
          </Button>
        </footer>
      </div>

      <aside className="ui-scroll-auto flex w-[280px] flex-none flex-col gap-5 overflow-y-auto border-l p-4">
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 text-base font-semibold leading-snug">{item.title}</h2>
            {dynamic ? (
              <span className="mt-0.5 flex-none rounded bg-primary/90 px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">
                {t("wallpaper.dynamicBadge")}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{item.resolution}</p>
        </div>

        <div className="grid gap-2">
          <Button type="button" className="w-full" disabled={saving} onClick={onApply}>
            {t("wallpaper.setWallpaper")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={saving}
            onClick={() => {
              if (dynamic) {
                toast.info(t("wallpaper.dynamicLogin"));
                return;
              }
              onDownload();
            }}
          >
            {t("wallpaper.download")}
          </Button>
        </div>
      </aside>
    </div>
  );
}
