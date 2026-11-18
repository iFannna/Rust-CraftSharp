/** 壁纸页：筛选、排序、分页、预览与应用，数据全部经由 Rust 命令 */

import { useEffect, useState } from "react";
import { updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf, type MessageKey } from "@/i18n";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";
import { Card, SectionHead, Select, type Option } from "@/settings/components/controls";
import {
  applyWallpaper,
  exportWallpaper,
  listWallpapers,
  pickSavePath,
  type WallpaperItem,
  type WallpaperKind,
  type WallpaperPage,
  type WallpaperSort
} from "@/settings/wallpaper/api";
import { WallpaperGrid } from "@/settings/wallpaper/grid";
import { WallpaperPreview } from "@/settings/wallpaper/preview";
import { Toast, useToast } from "@/settings/wallpaper/toast";

const KINDS: { value: WallpaperKind; key: MessageKey }[] = [
  { value: "all", key: "wallpaper.all" },
  { value: "static", key: "wallpaper.static" },
  { value: "dynamic", key: "wallpaper.dynamic" }
];

const SORTS: { value: WallpaperSort; key: MessageKey }[] = [
  { value: "latest", key: "wallpaper.sortLatest" },
  { value: "hot", key: "wallpaper.sortHot" },
  { value: "downloads", key: "wallpaper.sortDownloads" }
];

export function WallpaperSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const toast = useToast();

  const [kind, setKind] = useState<WallpaperKind>("all");
  const [sort, setSort] = useState<WallpaperSort>("latest");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<WallpaperPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listWallpapers(page, kind, sort)
      .then((next) => {
        if (cancelled) return;
        setData(next);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, kind, sort, reload]);

  const changeKind = (next: WallpaperKind) => {
    if (next === kind) return;
    setKind(next);
    setPage(1);
    setPreview(null);
  };

  const changeSort = (next: WallpaperSort) => {
    if (next === sort) return;
    setSort(next);
    setPage(1);
    setPreview(null);
  };

  const changePage = (next: number) => {
    setPage(next);
    setPreview(null);
  };

  const apply = async (item: WallpaperItem) => {
    if (item.kind !== "static" || applyingId !== null) return;
    setApplyingId(item.id);
    try {
      const localPath = await applyWallpaper(item);
      updateConfig({
        wallpaper: { currentId: item.id, title: item.title, type: "static", localPath }
      });
      toast.show(t("wallpaper.setSuccess"));
    } catch (reason) {
      toast.show(t("wallpaper.applyFailed", { reason: String(reason) }));
    } finally {
      setApplyingId(null);
    }
  };

  const download = async (item: WallpaperItem) => {
    if (item.kind !== "static" || savingId !== null) return;
    setSavingId(item.id);
    try {
      const path = await pickSavePath(item.title);
      if (path) {
        await exportWallpaper(item, path);
        toast.show(t("wallpaper.downloadSuccess"));
      }
    } catch (reason) {
      toast.show(t("wallpaper.downloadFailed", { reason: String(reason) }));
    } finally {
      setSavingId(null);
    }
  };

  const sortOptions: Option<WallpaperSort>[] = SORTS.map((item) => ({
    value: item.value,
    label: t(item.key)
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SectionHead title={t("wallpaper.title")} />

      <div className="mb-3 flex flex-none items-center gap-3">
        <div className="flex items-center gap-1">
          {KINDS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={cn(
                "h-9 rounded-md px-3 text-sm transition-colors",
                item.value === kind
                  ? "bg-secondary font-medium text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              aria-pressed={item.value === kind}
              onClick={() => changeKind(item.value)}
            >
              {t(item.key)}
            </button>
          ))}
        </div>
        <Select
          value={sort}
          options={sortOptions}
          ariaLabel={t("wallpaper.sort")}
          onChange={changeSort}
        />
      </div>

      <Card className="relative min-h-0 flex-1 overflow-hidden">
        <WallpaperGrid
          items={data?.items ?? []}
          loading={loading}
          error={error}
          applyingId={applyingId}
          t={t}
          onRetry={() => setReload((value) => value + 1)}
          onPreview={setPreview}
          onApply={(item) => void apply(item)}
        />
      </Card>

      <div className="mt-3 flex flex-none items-center justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={loading || !data?.hasPrev}
          onClick={() => changePage(page - 1)}
        >
          {t("wallpaper.prev")}
        </Button>
        <span className="min-w-[96px] text-center text-xs text-muted-foreground">
          {t("wallpaper.pageInfo", {
            page,
            total: data?.totalPages ?? "-"
          })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || !data?.hasNext}
          onClick={() => changePage(page + 1)}
        >
          {t("wallpaper.next")}
        </Button>
      </div>

      {preview !== null && data?.items[preview] ? (
        <WallpaperPreview
          items={data.items}
          index={preview}
          applyingId={applyingId}
          savingId={savingId}
          t={t}
          onClose={() => setPreview(null)}
          onIndexChange={setPreview}
          onApply={(item) => void apply(item)}
          onDownload={(item) => void download(item)}
        />
      ) : null}

      <Toast message={toast.message} />
    </div>
  );
}
