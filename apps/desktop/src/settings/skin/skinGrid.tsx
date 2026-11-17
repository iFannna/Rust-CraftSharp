import { useEffect, useRef } from "react";
import { Input } from "@/ui/components/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip";
import { Card } from "@/settings/components/controls";
import { displayName, sourceKey, type SkinSource, type SkinType } from "@/settings/skin/skinLibrary";
import { cn } from "@/ui/lib/utils";

interface SkinToolbarProps {
  type: SkinType;
  onChange: (type: SkinType) => void;
  onUpload: () => void;
  search: string;
  onSearch: (value: string) => void;
  labels: { steve: string; alex: string; upload: string; search: string };
}

export function SkinToolbar({ type, onChange, onUpload, search, onSearch, labels }: SkinToolbarProps) {
  return (
    <Card className="flex flex-none items-center gap-3 p-3">
      <div className="flex items-center gap-1">
        {(["wide", "slim"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={cn(
              "h-9 rounded-md px-3 text-sm transition-colors",
              value === type
                ? "bg-secondary font-medium text-secondary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
            aria-pressed={value === type}
            onClick={() => onChange(value)}
          >
            {value === "wide" ? labels.steve : labels.alex}
          </button>
        ))}
        <button
          type="button"
          className="h-9 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={onUpload}
        >
          {labels.upload}
        </button>
      </div>
      <Input
        type="search"
        value={search}
        placeholder={labels.search}
        aria-label={labels.search}
        className="ml-auto h-9 w-[180px]"
        onChange={(event) => onSearch(event.target.value)}
      />
    </Card>
  );
}

interface SkinGridProps {
  sources: SkinSource[];
  thumbs: Record<string, string>;
  selectedKey: string;
  emptyLabel: string;
  onSelect: (source: SkinSource) => void;
  onMenu: (source: SkinSource, x: number, y: number) => void;
}

export function SkinGrid({ sources, thumbs, selectedKey, emptyLabel, onSelect, onMenu }: SkinGridProps) {
  return (
    <div className="ui-scroll-auto h-full overflow-y-auto p-2">
      {sources.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2 min-[960px]:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
          {sources.map((source) => {
            const key = sourceKey(source);
            const selected = key === selectedKey;
            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="group flex min-w-0 flex-col rounded-lg p-1.5 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-pressed={selected}
                    onClick={() => onSelect(source)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onMenu(source, event.clientX, event.clientY);
                    }}
                  >
                    <span
                      className={cn(
                        "relative block aspect-square overflow-hidden rounded-md border-2 bg-muted/30 transition-colors",
                        selected ? "border-primary" : "border-transparent group-hover:border-border"
                      )}
                    >
                      {thumbs[key] ? (
                        <img
                          src={thumbs[key]}
                          alt=""
                          draggable={false}
                          className="absolute inset-0 h-full w-full object-contain"
                        />
                      ) : null}
                    </span>
                    <span className="block truncate px-1 pt-1.5 text-center text-xs text-muted-foreground">
                      {displayName(source)}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>{displayName(source)}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ) : (
        <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">{emptyLabel}</div>
      )}
    </div>
  );
}

export interface SkinMenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

interface SkinMenuProps {
  x: number;
  y: number;
  items: SkinMenuItem[];
  onClose: () => void;
}

export function SkinMenu({ x, y, items, onClose }: SkinMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const left = Math.max(8, Math.min(x, window.innerWidth - 176));
  const top = Math.max(8, Math.min(y, window.innerHeight - items.length * 32 - 12));

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[168px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left, top }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={cn(
            "block w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
            item.danger && "text-destructive"
          )}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
