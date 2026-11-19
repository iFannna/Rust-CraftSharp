/** 多屏目标与模式弹窗：同步、逐个设置、跨屏拼接及拼接裁剪 */

import { useState } from "react";
import { Button } from "@/ui/components/button";
import { XIcon } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";
import type { TFunction } from "@/i18n";
import type {
  SpanTransform,
  WallpaperItem,
  WallpaperMode,
  WallpaperMonitor
} from "@/settings/wallpaper/api";

interface TargetsProps {
  item: WallpaperItem;
  monitors: WallpaperMonitor[];
  initialMode: WallpaperMode;
  initialSelected: string[];
  initialTransform: SpanTransform;
  t: TFunction;
  onClose: () => void;
  onApply: (mode: WallpaperMode, selected: string[], transform: SpanTransform) => void;
}

const MODES: { value: WallpaperMode; key: "wallpaper.modeSync" | "wallpaper.modeIndependent" | "wallpaper.modeSpan" }[] = [
  { value: "sync", key: "wallpaper.modeSync" },
  { value: "independent", key: "wallpaper.modeIndependent" },
  { value: "span", key: "wallpaper.modeSpan" }
];

export function WallpaperTargets({
  item,
  monitors,
  initialMode,
  initialSelected,
  initialTransform,
  t,
  onClose,
  onApply
}: TargetsProps) {
  const [mode, setMode] = useState<WallpaperMode>(initialMode);
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [transform, setTransform] = useState<SpanTransform>(initialTransform);

  const toggle = (path: string) =>
    setSelected((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    );

  const hint =
    mode === "sync"
      ? t("wallpaper.modeHintSync")
      : mode === "independent"
        ? t("wallpaper.modeHintIndependent")
        : t("wallpaper.modeHintSpan");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("wallpaper.targetsTitle")}
      className="fixed inset-0 z-[60] flex flex-col bg-black/85"
    >
      <header className="flex flex-none items-center gap-4 px-5 py-4 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{t("wallpaper.targetsTitle")}</p>
          <p className="truncate text-xs text-white/60">{item.title}</p>
        </div>
        <Button
          autoFocus
          variant="ghost"
          size="icon"
          className="ml-auto text-white hover:bg-white/15 hover:text-white"
          aria-label={t("window.close")}
          onClick={onClose}
        >
          <XIcon className="h-5 w-5" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto px-6 py-2 text-white">
        <div className="flex items-center gap-1">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                "h-8 rounded px-3 text-sm transition-colors",
                option.value === mode
                  ? "bg-white text-black"
                  : "text-white/70 hover:bg-white/10"
              )}
              aria-pressed={option.value === mode}
              onClick={() => setMode(option.value)}
            >
              {t(option.key)}
            </button>
          ))}
        </div>
        <p className="text-xs text-white/60">{hint}</p>

        <MonitorDiagram
          monitors={monitors}
          selectable={mode === "independent"}
          selected={mode === "independent" ? selected : monitors.map((m) => m.devicePath)}
          onToggle={toggle}
          t={t}
        />

        {mode === "span" ? (
          <SpanPreview
            item={item}
            monitors={monitors}
            transform={transform}
            t={t}
            onChange={setTransform}
          />
        ) : null}
      </div>

      <footer className="flex flex-none justify-end gap-2 px-6 py-4">
        <Button variant="ghost" size="sm" className="text-white hover:bg-white/15 hover:text-white" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          disabled={mode === "independent" && selected.length === 0}
          onClick={() => onApply(mode, selected, transform)}
        >
          {t("wallpaper.apply")}
        </Button>
      </footer>
    </div>
  );
}

function MonitorDiagram({
  monitors,
  selectable,
  selected,
  onToggle,
  t
}: {
  monitors: WallpaperMonitor[];
  selectable: boolean;
  selected: string[];
  onToggle: (path: string) => void;
  t: TFunction;
}) {
  const bounds = virtualBounds(monitors);
  const ratio = bounds.width / bounds.height;
  const width = Math.min(560, window.innerWidth * 0.65, (window.innerHeight * 0.32) * ratio);
  const height = width / ratio;

  return (
    <div className="relative rounded border border-white/15 bg-white/5" style={{ width, height }}>
      {monitors.map((monitor, index) => {
        const left = ((monitor.left - bounds.left) / bounds.width) * 100;
        const top = ((monitor.top - bounds.top) / bounds.height) * 100;
        const w = ((monitor.right - monitor.left) / bounds.width) * 100;
        const h = ((monitor.bottom - monitor.top) / bounds.height) * 100;
        const active = selected.includes(monitor.devicePath);
        return (
          <button
            key={monitor.devicePath}
            type="button"
            disabled={!selectable}
            className={cn(
              "absolute flex flex-col items-center justify-center gap-1 rounded border text-[11px] transition-colors",
              active
                ? "border-primary bg-primary/25 text-white"
                : "border-white/20 text-white/50",
              selectable && "hover:border-white/60"
            )}
            style={{
              left: `calc(${left}% + 2px)`,
              top: `calc(${top}% + 2px)`,
              width: `calc(${w}% - 4px)`,
              height: `calc(${h}% - 4px)`
            }}
            aria-pressed={active}
            onClick={() => onToggle(monitor.devicePath)}
          >
            <span>{t("wallpaper.monitor", { index: index + 1 })}</span>
            <span className="text-white/50">
              {monitor.right - monitor.left}×{monitor.bottom - monitor.top}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SpanPreview({
  item,
  monitors,
  transform,
  t,
  onChange
}: {
  item: WallpaperItem;
  monitors: WallpaperMonitor[];
  transform: SpanTransform;
  t: TFunction;
  onChange: (value: SpanTransform) => void;
}) {
  const bounds = virtualBounds(monitors);
  const ratio = bounds.width / bounds.height;
  const width = Math.min(520, window.innerWidth * 0.6, (window.innerHeight * 0.3) * ratio);
  const height = width / ratio;

  return (
    <div className="flex w-full max-w-[620px] flex-col items-center gap-3">
      <div className="relative overflow-hidden rounded border border-white/15" style={{ width, height }}>
        <img
          src={item.previewUrl}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
          style={{
            transform: `translate(${transform.offsetX * 100}%, ${transform.offsetY * 100}%) scale(${transform.zoom})`
          }}
        />
        <div className="pointer-events-none absolute inset-0">
          {monitors.map((monitor) => (
            <div
              key={monitor.devicePath}
              className="absolute border border-dashed border-white/50"
              style={{
                left: `${((monitor.left - bounds.left) / bounds.width) * 100}%`,
                top: `${((monitor.top - bounds.top) / bounds.height) * 100}%`,
                width: `${((monitor.right - monitor.left) / bounds.width) * 100}%`,
                height: `${((monitor.bottom - monitor.top) / bounds.height) * 100}%`
              }}
            />
          ))}
        </div>
      </div>
      <div className="grid w-full gap-2">
        <Slider
          label={t("wallpaper.spanZoom")}
          value={transform.zoom}
          min={1}
          max={3}
          step={0.05}
          onChange={(zoom) => onChange({ ...transform, zoom })}
        />
        <Slider
          label={t("wallpaper.spanOffsetX")}
          value={transform.offsetX}
          min={-1}
          max={1}
          step={0.01}
          onChange={(offsetX) => onChange({ ...transform, offsetX })}
        />
        <Slider
          label={t("wallpaper.spanOffsetY")}
          value={transform.offsetY}
          min={-1}
          max={1}
          step={0.01}
          onChange={(offsetY) => onChange({ ...transform, offsetY })}
        />
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[96px_minmax(0,1fr)_56px] items-center gap-3 text-xs">
      <span className="text-white/70">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="text-right tabular-nums text-white/50">{value.toFixed(2)}</span>
    </label>
  );
}

function virtualBounds(monitors: WallpaperMonitor[]) {
  if (!monitors.length) return { left: 0, top: 0, width: 16, height: 9 };
  const left = Math.min(...monitors.map((m) => m.left));
  const top = Math.min(...monitors.map((m) => m.top));
  const right = Math.max(...monitors.map((m) => m.right));
  const bottom = Math.max(...monitors.map((m) => m.bottom));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
