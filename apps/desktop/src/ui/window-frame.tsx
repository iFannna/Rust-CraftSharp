import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig } from "@/config/appConfig";
import { tOf } from "@/i18n";
import { isTauri } from "@/lib/runtime";
import { cn } from "@/ui/lib/utils";
import { TitleBar } from "@/ui/title-bar";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const RESIZE_EDGES: { direction: ResizeDirection; className: string }[] = [
  { direction: "North", className: "left-2 right-2 top-0 h-1 cursor-ns-resize" },
  { direction: "South", className: "bottom-0 left-2 right-2 h-1 cursor-ns-resize" },
  { direction: "East", className: "bottom-2 right-0 top-2 w-1 cursor-ew-resize" },
  { direction: "West", className: "bottom-2 left-0 top-2 w-1 cursor-ew-resize" },
  { direction: "NorthEast", className: "right-0 top-0 h-2 w-2 cursor-nesw-resize" },
  { direction: "NorthWest", className: "left-0 top-0 h-2 w-2 cursor-nwse-resize" },
  { direction: "SouthEast", className: "bottom-0 right-0 h-2 w-2 cursor-nwse-resize" },
  { direction: "SouthWest", className: "bottom-0 left-0 h-2 w-2 cursor-nesw-resize" }
];

function windowApi() {
  return isTauri() ? getCurrentWindow() : null;
}

interface WindowFrameProps {
  title: string;
  controls?: "full" | "close";
  resizable?: boolean;
  onClose: () => void;
  onMaximizedChange?: (maximized: boolean) => void;
  children: ReactNode;
}

/** 所有桌面窗口共用的外框：标题栏、可缩放的边缘、窗口操作 */
export function WindowFrame({
  title,
  controls = "full",
  resizable = false,
  onClose,
  onMaximizedChange,
  children
}: WindowFrameProps) {
  const [maximized, setMaximized] = useState(false);
  const maximizedListener = useRef(onMaximizedChange);
  maximizedListener.current = onMaximizedChange;

  useEffect(() => {
    if (controls !== "full" || !isTauri()) return;
    void invoke("install_caption_hook").catch(() => undefined);
  }, [controls]);

  useEffect(() => {
    if (!resizable) return;
    const current = windowApi();
    if (!current) return;

    let dispose: (() => void) | undefined;
    const sync = () => {
      void current
        .isMaximized()
        .then((value) => {
          setMaximized(value);
          maximizedListener.current?.(value);
        })
        .catch(() => undefined);
    };

    sync();
    void current
      .onResized(sync)
      .then((unlisten) => {
        dispose = unlisten;
      })
      .catch(() => undefined);

    return () => dispose?.();
  }, [resizable]);

  const t = tOf(getConfig().system.language);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {resizable && !maximized
        ? RESIZE_EDGES.map((edge) => (
            <div
              key={edge.direction}
              className={cn("fixed z-50", edge.className)}
              aria-hidden="true"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                void windowApi()?.startResizeDragging(edge.direction).catch(() => undefined);
              }}
            />
          ))
        : null}

      <TitleBar
        title={title}
        maximized={maximized}
        labels={{
          minimize: t("window.minimize"),
          maximize: t("window.maximize"),
          restore: t("window.restore"),
          close: t("window.close")
        }}
        onMinimize={
          controls === "full"
            ? () => void windowApi()?.minimize().catch(() => undefined)
            : undefined
        }
        onMaximize={
          controls === "full"
            ? () => void windowApi()?.toggleMaximize().catch(() => undefined)
            : undefined
        }
        onClose={onClose}
      />

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
