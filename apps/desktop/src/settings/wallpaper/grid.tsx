/** 壁纸卡片网格：缩略图状态、动态角标、悬浮操作与整页状态 */

import { useState, type ReactNode } from "react";
import { Button } from "@/ui/components/button";
import { WarningIcon } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";
import type { TFunction } from "@/i18n";
import type { WallpaperItem } from "@/settings/wallpaper/api";

interface WallpaperGridProps {
  items: WallpaperItem[];
  loading: boolean;
  error: string | null;
  applyingId: string | null;
  t: TFunction;
  onRetry: () => void;
  onPreview: (index: number) => void;
  onApply: (item: WallpaperItem) => void;
}

export function WallpaperGrid({
  items,
  loading,
  error,
  applyingId,
  t,
  onRetry,
  onPreview,
  onApply
}: WallpaperGridProps) {
  if (loading) {
    return (
      <CenteredState>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">{t("wallpaper.loading")}</p>
      </CenteredState>
    );
  }

  if (error) {
    return (
      <CenteredState>
        <WarningIcon className="h-8 w-8 text-muted-foreground" />
        <p className="text-base font-medium">{t("wallpaper.errorTitle")}</p>
        <p className="max-w-[400px] text-center text-sm text-muted-foreground">
          {t("wallpaper.errorDesc")}
        </p>
        <p className="max-w-[400px] break-all text-center text-xs text-muted-foreground/70">{error}</p>
        <Button size="sm" onClick={onRetry}>
          {t("wallpaper.retry")}
        </Button>
      </CenteredState>
    );
  }

  if (!items.length) {
    return (
      <CenteredState>
        <p className="text-sm text-muted-foreground">{t("wallpaper.empty")}</p>
      </CenteredState>
    );
  }

  return (
    <div className="ui-scroll-auto h-full overflow-y-auto p-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
        {items.map((item, index) => (
          <WallpaperCard
            key={item.id}
            item={item}
            index={index}
            applying={applyingId === item.id}
            t={t}
            onPreview={onPreview}
            onApply={onApply}
          />
        ))}
      </div>
    </div>
  );
}

function CenteredState({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="flex flex-col items-center gap-3">{children}</div>
    </div>
  );
}

interface WallpaperCardProps {
  item: WallpaperItem;
  index: number;
  applying: boolean;
  t: TFunction;
  onPreview: (index: number) => void;
  onApply: (item: WallpaperItem) => void;
}

function WallpaperCard({ item, index, applying, t, onPreview, onApply }: WallpaperCardProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const dynamic = item.kind === "dynamic";

  return (
    <article className="group relative aspect-[16/10] overflow-hidden rounded-lg border bg-muted/30">
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`${item.title} - ${t("wallpaper.viewImage")}`}
        onClick={() => onPreview(index)}
      />

      {status !== "error" ? (
        <img
          src={item.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
          className={cn(
            "pointer-events-none absolute inset-0 h-full w-full object-cover transition duration-200 ease-out group-hover:scale-[1.06]",
            status === "loading" ? "opacity-0" : "opacity-100"
          )}
        />
      ) : null}

      {status === "loading" ? (
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-muted/60" />
      ) : null}

      {status === "error" ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center gap-1 text-muted-foreground">
          <WarningIcon className="h-6 w-6" />
          <span className="text-xs">{t("wallpaper.imageFailed")}</span>
        </div>
      ) : null}

      {dynamic ? (
        <span className="pointer-events-none absolute left-2 top-2 z-[6] rounded bg-primary/90 px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">
          {t("wallpaper.dynamicBadge")}
        </span>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8">
        <p className="truncate text-xs text-white">{item.title}</p>
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-black/50 opacity-0 transition-opacity duration-200 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => onPreview(index)}>
            {t("wallpaper.viewImage")}
          </Button>
          <Button
            size="sm"
            disabled={dynamic || applying}
            title={dynamic ? t("wallpaper.dynamicUnsupported") : undefined}
            onClick={() => onApply(item)}
          >
            {applying ? t("wallpaper.setting") : t("wallpaper.setWallpaper")}
          </Button>
        </div>
      </div>
    </article>
  );
}
