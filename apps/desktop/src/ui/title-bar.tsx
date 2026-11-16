import { Copy, Minus, Square, X } from "lucide-react";
import { cn } from "@/ui/lib/utils";

const captionClass =
  "no-drag inline-flex h-full w-[46px] items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** 自定义标题栏；macOS 原生红绿灯要等平台窗口配置就绪后再切换 */
export function TitleBar({
  title,
  maximized,
  labels,
  onMinimize,
  onMaximize,
  onClose,
}: {
  title: string;
  maximized: boolean;
  labels: {
    minimize: string;
    maximize: string;
    restore: string;
    close: string;
  };
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}) {
  return (
    <header
      className="drag-region flex h-12 flex-none items-center"
      data-tauri-drag-region
    >
      <span
        className="flex h-full items-center px-4 text-sm font-semibold tracking-tight"
        data-tauri-drag-region
      >
        {title}
      </span>
      <div className="ml-auto flex h-full">
        <button
          type="button"
          className={captionClass}
          aria-label={labels.minimize}
          onClick={onMinimize}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={captionClass}
          aria-label={maximized ? labels.restore : labels.maximize}
          onClick={onMaximize}
        >
          {maximized ? (
            <Copy className="h-3.5 w-3.5" />
          ) : (
            <Square className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          className={cn(
            captionClass,
            "hover:bg-destructive hover:text-destructive-foreground",
          )}
          aria-label={labels.close}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
