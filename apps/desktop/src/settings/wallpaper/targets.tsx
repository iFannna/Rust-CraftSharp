/** 壁纸设置面板：应用方式、显示器选择与实际效果预览 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip";
import { cn } from "@/ui/lib/utils";
import type { TFunction } from "@/i18n";
import type {
  SpanTransform,
  WallpaperItem,
  WallpaperMode,
  WallpaperMonitor
} from "./api";

interface WallpaperApplyPanelProps {
  item: WallpaperItem;
  monitors: WallpaperMonitor[];
  initialMode: WallpaperMode;
  initialSelected: string[];
  initialTransform: SpanTransform;
  busy: boolean;
  t: TFunction;
  onClose: () => void;
  onApply: (mode: WallpaperMode, selected: string[], transform: SpanTransform) => void;
}

const MODES: { value: WallpaperMode; key: "wallpaper.modeSync" | "wallpaper.modeIndependent" | "wallpaper.modeSpan" }[] = [
  { value: "sync", key: "wallpaper.modeSync" },
  { value: "independent", key: "wallpaper.modeIndependent" },
  { value: "span", key: "wallpaper.modeSpan" }
];

export function WallpaperApplyPanel({
  item,
  monitors,
  initialMode,
  initialSelected,
  initialTransform,
  busy,
  t,
  onClose,
  onApply
}: WallpaperApplyPanelProps) {
  const [mode, setMode] = useState<WallpaperMode>(initialMode);
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [transform, setTransform] = useState<SpanTransform>(initialTransform);

  const toggle = (path: string) =>
    setSelected((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="ui-scroll-auto min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[1120px] flex-col gap-6 p-5">
          <div className="flex flex-none items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={item.title}>
                {item.title}
              </p>
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{item.resolution}</p>
            </div>
            <div className="flex w-[300px] flex-none gap-1 rounded-lg border bg-muted/40 p-1">
              {MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "h-8 flex-1 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                    option.value === mode
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-pressed={option.value === mode}
                  disabled={busy}
                  onClick={() => setMode(option.value)}
                >
                  {t(option.key)}
                </button>
              ))}
            </div>
          </div>

          <div className="relative min-h-[200px] flex-1">
            <MonitorStage
              item={item}
              monitors={monitors}
              mode={mode}
              selected={selected}
              busy={busy}
              transform={transform}
              onToggle={toggle}
              onTransform={setTransform}
              t={t}
            />
          </div>
        </div>
      </div>

      <footer className="flex-none">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-end gap-2 px-5 py-3">
          <Button
            type="button"
            variant="outline"
            className="min-w-[84px]"
            disabled={busy}
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            className="min-w-[84px] gap-2"
            disabled={busy || (mode === "independent" && selected.length === 0)}
            onClick={() => onApply(mode, selected, transform)}
          >
            {busy ? (
              <span className="size-3.5 flex-none animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
            ) : null}
            {busy ? t("wallpaper.setting") : t("wallpaper.apply")}
          </Button>
        </div>
      </footer>
    </div>
  );
}

/** 按容器宽高拟合显示器拼合比例，窗口缩放实时跟随 */
function useStageSize(ratio: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      if (!node.clientWidth || !node.clientHeight) return;
      const width = Math.max(1, Math.min(node.clientWidth, node.clientHeight * ratio));
      const next = { width, height: width / ratio };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ratio]);

  return { ref, width: size.width, height: size.height };
}

function MonitorStage({
  item,
  monitors,
  mode,
  selected,
  busy,
  transform,
  onToggle,
  onTransform,
  t
}: {
  item: WallpaperItem;
  monitors: WallpaperMonitor[];
  mode: WallpaperMode;
  selected: string[];
  busy: boolean;
  transform: SpanTransform;
  onToggle: (path: string) => void;
  onTransform: (transform: SpanTransform) => void;
  t: TFunction;
}) {
  const bounds = virtualBounds(monitors);
  const ratio = bounds.width / bounds.height;
  const { ref, width, height } = useStageSize(ratio);
  const spanRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  /** 偏移只允许到图片仍铺满画布的范围 */
  const clampOffset = (value: number, zoom: number) => {
    const limit = Math.max(0, (zoom - 1) / 2);
    return Math.min(limit, Math.max(-limit, value));
  };

  const updateSpan = (next: SpanTransform) =>
    onTransform({
      zoom: next.zoom,
      offsetX: clampOffset(next.offsetX, next.zoom),
      offsetY: clampOffset(next.offsetY, next.zoom)
    });

  useEffect(() => {
    if (mode !== "span" || busy) return;
    const node = spanRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      updateSpan({
        zoom: Math.round(Math.min(3, Math.max(1, transform.zoom + (event.deltaY < 0 ? 0.1 : -0.1))) * 100) / 100,
        offsetX: transform.offsetX,
        offsetY: transform.offsetY
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [mode, busy, transform]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "span" || busy || transform.zoom <= 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    updateSpan({
      zoom: transform.zoom,
      offsetX: drag.offsetX + (event.clientX - drag.x) / rect.width,
      offsetY: drag.offsetY + (event.clientY - drag.y) / rect.height
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const tileStyle = (monitor: WallpaperMonitor) => ({
    left: `calc(${((monitor.left - bounds.left) / bounds.width) * 100}% + 2px)`,
    top: `calc(${((monitor.top - bounds.top) / bounds.height) * 100}% + 2px)`,
    width: `calc(${((monitor.right - monitor.left) / bounds.width) * 100}% - 4px)`,
    height: `calc(${((monitor.bottom - monitor.top) / bounds.height) * 100}% - 4px)`
  });

  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center">
      <div className="relative" style={{ width, height }}>
        {mode === "span" ? (
          <>
            <div
              ref={spanRef}
              className={cn(
                "absolute inset-0 touch-none overflow-hidden border bg-muted/20",
                transform.zoom > 1 && !busy && "cursor-grab active:cursor-grabbing"
              )}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={() => onTransform({ zoom: 1, offsetX: 0, offsetY: 0 })}
            >
              <img
                src={item.previewUrl}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
                style={{
                  transform: `translate(${transform.offsetX * 100}%, ${transform.offsetY * 100}%) scale(${transform.zoom})`
                }}
              />
            </div>
            {monitors.map((monitor, index) => (
              <div
                key={monitor.devicePath}
                className="pointer-events-none absolute border border-dashed border-foreground/50"
                style={tileStyle(monitor)}
              >
                <span className="absolute bottom-1.5 left-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium leading-none text-foreground shadow-sm backdrop-blur">
                  {t("wallpaper.monitor", { index: index + 1 })}
                </span>
              </div>
            ))}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="absolute bottom-2 right-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums text-foreground shadow-sm backdrop-blur">
                  {transform.zoom.toFixed(2)}×
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("wallpaper.spanHint")}</TooltipContent>
            </Tooltip>
          </>
        ) : (
          monitors.map((monitor, index) => {
            const active = mode === "sync" || selected.includes(monitor.devicePath);
            return (
              <button
                key={monitor.devicePath}
                type="button"
                disabled={mode === "sync" || busy}
                className={cn(
                  "absolute overflow-hidden border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default",
                  active ? "border-primary/70" : "border-border",
                  mode === "independent" && !busy && "cursor-pointer hover:border-ring"
                )}
                style={tileStyle(monitor)}
                aria-pressed={mode === "independent" ? active : undefined}
                onClick={() => onToggle(monitor.devicePath)}
              >
                <img
                  src={item.previewUrl}
                  alt=""
                  draggable={false}
                  className={cn(
                    "absolute inset-0 size-full object-cover",
                    !active && "opacity-25 grayscale"
                  )}
                />
                {!active ? (
                  <span className="absolute inset-0 grid place-items-center">
                    <span className="rounded border bg-background/85 px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm">
                      {t("wallpaper.monitorOff")}
                    </span>
                  </span>
                ) : null}
                <span className="absolute bottom-1.5 left-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium leading-none text-foreground shadow-sm backdrop-blur">
                  {t("wallpaper.monitor", { index: index + 1 })}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function virtualBounds(monitors: WallpaperMonitor[]) {
  if (!monitors.length) return { left: 0, top: 0, width: 16, height: 9 };
  const left = Math.min(...monitors.map((monitor) => monitor.left));
  const top = Math.min(...monitors.map((monitor) => monitor.top));
  const right = Math.max(...monitors.map((monitor) => monitor.right));
  const bottom = Math.max(...monitors.map((monitor) => monitor.bottom));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
