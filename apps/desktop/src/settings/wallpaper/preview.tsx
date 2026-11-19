/** 壁纸预览浮层：缩放、拖拽、切换与下载，设置页内完成，不额外开窗 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/ui/components/button";
import { WarningIcon, XIcon } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";
import type { TFunction } from "@/i18n";
import type { WallpaperItem } from "@/settings/wallpaper/api";

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const FIT_INDEX = 3;

interface WallpaperPreviewProps {
  items: WallpaperItem[];
  index: number;
  applyingId: string | null;
  savingId: string | null;
  dynamicEnabled: boolean;
  t: TFunction;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onApply: (item: WallpaperItem) => void;
  onDownload: (item: WallpaperItem) => void;
}

export function WallpaperPreview({
  items,
  index,
  applyingId,
  savingId,
  dynamicEnabled,
  t,
  onClose,
  onIndexChange,
  onApply,
  onDownload
}: WallpaperPreviewProps) {
  const item = items[index];
  const [zoomIndex, setZoomIndex] = useState(FIT_INDEX);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const zoom = ZOOM_LEVELS[zoomIndex];
  const dynamic = item?.kind === "dynamic";
  const applying = item ? applyingId === item.id : false;
  const saving = item ? savingId === item.id : false;

  useEffect(() => {
    setZoomIndex(FIT_INDEX);
    setOffset({ x: 0, y: 0 });
    setStatus("loading");
  }, [index]);

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
        onIndexChange(index - 1);
      }
      if (event.key === "ArrowRight" && index < items.length - 1) {
        event.preventDefault();
        onIndexChange(index + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, items.length, onClose, onIndexChange]);

  if (!item) return null;

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

  const footerButton = "text-white hover:bg-white/15 hover:text-white";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("wallpaper.previewTitle")}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
    >
      <header className="flex flex-none items-center gap-4 px-5 py-4 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <p className="text-xs text-white/60">
            {item.resolution}
            {dynamic ? ` · ${t("wallpaper.dynamicBadge")}` : ""}
          </p>
        </div>
        <Button
          autoFocus
          variant="ghost"
          size="icon"
          className={cn("ml-auto", footerButton)}
          aria-label={t("window.close")}
          onClick={onClose}
        >
          <XIcon className="h-5 w-5" />
        </Button>
      </header>

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
              "max-h-full max-w-full object-contain",
              status === "ready" ? "opacity-100" : "opacity-0"
            )}
          />
        </div>

        {status === "loading" ? (
          <div className="absolute inset-0 grid place-items-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          </div>
        ) : null}

        {status === "error" ? (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2 text-white/70">
              <WarningIcon className="h-7 w-7" />
              <span className="text-sm">{t("wallpaper.imageFailed")}</span>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="flex flex-none flex-wrap items-center justify-center gap-2 px-5 py-4">
        <Button
          variant="ghost"
          size="sm"
          className={footerButton}
          disabled={index <= 0}
          onClick={() => onIndexChange(index - 1)}
        >
          {t("wallpaper.prevImage")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={footerButton}
          disabled={index >= items.length - 1}
          onClick={() => onIndexChange(index + 1)}
        >
          {t("wallpaper.nextImage")}
        </Button>
        <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />
        <Button variant="ghost" size="sm" className={footerButton} onClick={resetView}>
          {t("wallpaper.fit")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={footerButton}
          disabled={zoomIndex <= 0}
          aria-label={t("wallpaper.zoomOut")}
          onClick={() => zoomBy(-1)}
        >
          -
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={footerButton}
          disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
          aria-label={t("wallpaper.zoomIn")}
          onClick={() => zoomBy(1)}
        >
          +
        </Button>
        <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />
        <Button
          variant="ghost"
          size="sm"
          className={footerButton}
          disabled={dynamic || saving || applying}
          title={dynamic ? t("wallpaper.dynamicUnsupported") : undefined}
          onClick={() => onDownload(item)}
        >
          {t("wallpaper.download")}
        </Button>
        <Button
          size="sm"
          disabled={applying || saving}
          title={dynamic && !dynamicEnabled ? t("wallpaper.dynamicLogin") : undefined}
          onClick={() => onApply(item)}
        >
          {applying ? t("wallpaper.setting") : t("wallpaper.setWallpaper")}
        </Button>
      </footer>
    </div>
  );
}
