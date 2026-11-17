import { useEffect, useRef, useState, type CSSProperties } from "react";
import { tOf, type MessageKey } from "@/i18n";
import { useAppConfig } from "@/config/useAppConfig";
import { useResolvedTheme } from "@/settings/theme";
import { sourceUrl, type SkinSource } from "@/settings/skin/skinLibrary";
import type { SkinPreview as SkinPreviewStage } from "@/settings/skin/skinScene";
import { Button } from "@/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip";
import { ActionIcon, ChevronDownIcon, PauseIcon, PlayIcon, RotateIcon } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";

type PreviewBackground = "white" | "black" | "gray" | "grid";

/** 白、黑、灰取主题调色板的中性色；网格复用 3D 预览窗口的棋盘格 */
const BACKGROUNDS: Record<PreviewBackground, { style?: CSSProperties; className?: string }> = {
  white: { style: { backgroundColor: "#ffffff" } },
  black: { style: { backgroundColor: "#0a0a0a" } },
  gray: { style: { backgroundColor: "#262626" } },
  grid: { className: "preview-checker" }
};

const BACKGROUND_OPTIONS: { id: PreviewBackground; label: MessageKey }[] = [
  { id: "black", label: "skin.backgroundBlack" },
  { id: "white", label: "skin.backgroundWhite" },
  { id: "gray", label: "skin.backgroundGray" },
  { id: "grid", label: "skin.backgroundGrid" }
];

/** 右侧预览：标题栏切换动作、暂停与自动旋转，底部切换背景 */
export function SkinPreviewPanel({ source }: { source: SkinSource }) {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<SkinPreviewStage | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState("idle");
  const [playing, setPlaying] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const theme = useResolvedTheme(config.appearance.theme);
  const [background, setBackground] = useState<PreviewBackground>(theme === "dark" ? "black" : "white");
  const pickedBackground = useRef(false);

  // 未手动选过背景时，默认值跟随主题深浅
  useEffect(() => {
    if (!pickedBackground.current) setBackground(theme === "dark" ? "black" : "white");
  }, [theme]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    let disposed = false;
    let observer: ResizeObserver | undefined;
    let detach: (() => void) | undefined;

    void import("@/settings/skin/skinScene")
      .then(({ SkinPreview }) => {
        if (disposed) return;
        const stage = new SkinPreview(canvas);
        stageRef.current = stage;
        setActions(stage.animations());
        const fit = () => stage.resize(host.clientWidth, host.clientHeight);
        observer = new ResizeObserver(fit);
        observer.observe(host);
        fit();

        const onWheel = (event: WheelEvent) => {
          event.preventDefault();
          stage.zoomBy(event.deltaY);
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });
        detach = () => canvas.removeEventListener("wheel", onWheel);
        setReady(true);
      })
      .catch(() => setFailed(true));

    return () => {
      disposed = true;
      observer?.disconnect();
      detach?.();
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setFailed(false);
    void sourceUrl(source)
      .then((url) => {
        if (!cancelled) return stageRef.current?.load(source.type, url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source, ready]);

  useEffect(() => {
    stageRef.current?.setAnimation(action);
  }, [action, ready]);

  useEffect(() => {
    stageRef.current?.setPlaying(playing);
  }, [playing, ready]);

  useEffect(() => {
    stageRef.current?.setSpinning(spinning);
  }, [spinning, ready]);

  const cycleAction = () => {
    if (!actions.length) return;
    const index = actions.indexOf(action);
    setAction(actions[(index + 1) % actions.length]);
  };

  // 拖拽时临时停下自动旋转，松手恢复
  const suspendSpin = (suspend: boolean) => {
    if (spinning) stageRef.current?.setSpinning(!suspend);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 flex-none items-center justify-between gap-3 border-b px-4">
        <span className="text-sm font-medium">{t("skin.previewTitle")}</span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!actions.length}
                aria-label={`${t("skin.actionSwitch")} · ${action}`}
                onClick={cycleAction}
              >
                <ActionIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`${t("skin.actionSwitch")} · ${action}`}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={playing ? t("skin.actionPause") : t("skin.actionPlay")}
                aria-pressed={!playing}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{playing ? t("skin.actionPause") : t("skin.actionPlay")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", spinning && "bg-accent text-accent-foreground")}
                aria-label={t("skin.actionRotate")}
                aria-pressed={spinning}
                onClick={() => setSpinning(!spinning)}
              >
                <RotateIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("skin.actionRotate")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        ref={hostRef}
        className={cn("relative min-h-0 flex-1", BACKGROUNDS[background].className)}
        style={BACKGROUNDS[background].style}
      >
        <canvas
          ref={canvasRef}
          className={cn("absolute inset-0 h-full w-full touch-none", dragging ? "cursor-grabbing" : "cursor-grab")}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            dragRef.current = { x: event.clientX, y: event.clientY };
            setDragging(true);
            suspendSpin(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const last = dragRef.current;
            if (!last) return;
            stageRef.current?.rotate(event.clientX - last.x, event.clientY - last.y);
            dragRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={() => {
            dragRef.current = null;
            setDragging(false);
            suspendSpin(false);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setDragging(false);
            suspendSpin(false);
          }}
          onDoubleClick={() => stageRef.current?.reset()}
        />
        {failed ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="rounded-md bg-background/85 px-3 py-1.5 text-sm text-foreground">
              {t("skin.previewFailed")}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex h-12 flex-none items-center justify-between gap-3 border-t px-4">
        <div className="flex items-center gap-2">
          {BACKGROUND_OPTIONS.map((option) => (
            <Tooltip key={option.id}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={cn(
                    "size-6 rounded-full border-border p-0 hover:bg-transparent",
                    BACKGROUNDS[option.id].className,
                    background === option.id && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  )}
                  style={BACKGROUNDS[option.id].style}
                  aria-label={t(option.label)}
                  aria-pressed={background === option.id}
                  onClick={() => {
                    pickedBackground.current = true;
                    setBackground(option.id);
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>{t(option.label)}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled
                  aria-label={t("skin.backgroundPrevScene")}
                >
                  <ChevronDownIcon className="rotate-90" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("skin.backgroundPrevScene")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled
                  aria-label={t("skin.backgroundNextScene")}
                >
                  <ChevronDownIcon className="-rotate-90" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("skin.backgroundNextScene")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
