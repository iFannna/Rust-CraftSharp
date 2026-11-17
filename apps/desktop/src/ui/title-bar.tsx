import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";

const captionClass =
  "no-drag inline-flex h-8 w-[46px] items-center justify-center self-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

interface TitleBarProps {
  title: string;
  labels: {
    minimize?: string;
    maximize?: string;
    restore?: string;
    close: string;
  };
  maximized?: boolean;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose: () => void;
}

/** 自绘标题栏，展示框带三键，对话框只留关闭 */
export function TitleBar({
  title,
  labels,
  maximized = false,
  onMinimize,
  onMaximize,
  onClose
}: TitleBarProps) {
  return (
    <header className="drag-region flex h-8 flex-none items-center" data-tauri-drag-region>
      {title ? (
        <span
          className="flex h-full translate-y-[2px] items-center pl-5 text-sm font-semibold tracking-tight"
          data-tauri-drag-region
        >
          {title}
        </span>
      ) : null}
      <div className="ml-auto flex h-full">
        {onMinimize && onMaximize ? (
          <>
            <button
              type="button"
              className={captionClass}
              aria-label={labels.minimize}
              onClick={onMinimize}
            >
              <MinusIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              data-caption="maximize"
              className={captionClass}
              aria-label={maximized ? labels.restore : labels.maximize}
              onClick={onMaximize}
            >
              {maximized ? <CopyIcon className="h-4 w-4" /> : <SquareIcon className="h-4 w-4" />}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className={cn(captionClass, "hover:bg-destructive hover:text-destructive-foreground")}
          aria-label={labels.close}
          onClick={onClose}
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
