import { useEffect, type ReactNode } from "react";
import { XIcon } from "@/ui/icons";

interface SkinModalProps {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}

/** 皮肤页弹窗壳：遮罩、标题栏、Esc 与点击遮罩关闭 */
export function SkinModal({ title, closeLabel, onClose, children, footer }: SkinModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-full w-full max-w-[640px] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
      >
        <div className="flex flex-none items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-medium">{title}</h2>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="ui-scroll-auto min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex flex-none justify-end gap-2 border-t px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}
