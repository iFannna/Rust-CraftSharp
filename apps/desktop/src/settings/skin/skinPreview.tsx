import { useEffect, useRef, useState } from "react";
import { tOf } from "@/i18n";
import { useAppConfig } from "@/config/useAppConfig";
import { sourceUrl, type SkinSource } from "@/settings/skin/skinLibrary";
import type { SkinPreview as SkinPreviewStage } from "@/settings/skin/skinScene";
import { cn } from "@/ui/lib/utils";

/** 右侧预览：正交相机，静态待机姿态，按需重绘 */
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

  return (
    <div ref={hostRef} className="relative h-full w-full bg-muted/20">
      <canvas
        ref={canvasRef}
        className={cn("absolute inset-0 h-full w-full touch-none", dragging ? "cursor-grabbing" : "cursor-grab")}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragRef.current = { x: event.clientX, y: event.clientY };
          setDragging(true);
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
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onDoubleClick={() => stageRef.current?.reset()}
      />
      {failed ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          {t("skin.previewFailed")}
        </div>
      ) : null}
    </div>
  );
}
