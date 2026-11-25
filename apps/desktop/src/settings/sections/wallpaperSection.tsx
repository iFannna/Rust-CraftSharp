/** 壁纸页：筛选、排序与分页；查看和设置分别交给独立窗口 */

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf, type MessageKey } from "@/i18n";
import { isTauri } from "@/lib/runtime";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";
import { SectionHead, Select, type Option } from "@/settings/components/controls";
import {
  listWallpapers,
  type WallpaperKind,
  type WallpaperPage,
  type WallpaperSort
} from "@/settings/wallpaper/api";
import { WallpaperGrid } from "@/settings/wallpaper/grid";
import { useWallpaperSession } from "@/settings/wallpaper/session";
import { openWallpaperApply, openWallpaperPreview } from "@/settings/wallpaper/windows";

const KINDS: { value: WallpaperKind; key: MessageKey }[] = [
  { value: "all", key: "wallpaper.all" },
  { value: "static", key: "wallpaper.static" },
  { value: "dynamic", key: "wallpaper.dynamic" }
];

const SORTS: { value: WallpaperSort; key: MessageKey }[] = [
  { value: "latest", key: "wallpaper.sortLatest" },
  { value: "popular", key: "wallpaper.sortHot" },
  { value: "downloads", key: "wallpaper.sortDownloads" }
];

export function WallpaperSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const { session, openLogin, signOut } = useWallpaperSession(() =>
    toast.success(t("wallpaper.loginSuccess"))
  );

  const [kind, setKind] = useState<WallpaperKind>("all");
  const [sort, setSort] = useState<WallpaperSort>("latest");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<WallpaperPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 解码失败时桌面只剩一张不动的封面，这里给出明确提示
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void listen("wallpaper-video-error", () => {
      toast.error(tRef.current("wallpaper.videoError"));
    }).then((off) => {
      if (cancelled) off();
      else dispose = off;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listWallpapers(page, kind, sort)
      .then((next) => {
        if (!cancelled) setData(next);
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
  };

  const changeSort = (next: WallpaperSort) => {
    if (next === sort) return;
    setSort(next);
    setPage(1);
  };

  const sortOptions: Option<WallpaperSort>[] = SORTS.map((item) => ({
    value: item.value,
    label: t(item.key)
  }));

  const handleSignOut = async () => {
    await signOut();
    toast.success(t("wallpaper.logoutSuccess"));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SectionHead title={t("wallpaper.title")} />

      <div className="mb-2 flex flex-none flex-wrap items-center gap-3">
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
        {isTauri() ? (
          <div className="ml-auto flex flex-none items-center">
            {session ? (
              <Button variant="ghost" size="sm" onClick={() => void handleSignOut()}>
                {t("wallpaper.logout")}
              </Button>
            ) : (
              <Button size="sm" onClick={() => void openLogin(t("wallpaper.loginTitle"))}>
                {t("wallpaper.login")}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <div className="relative mb-2 min-h-0 flex-1 overflow-hidden">
        <WallpaperGrid
          key={session ? "clean" : "public"}
          items={data?.items ?? []}
          loading={loading}
          error={error}
          t={t}
          onRetry={() => setReload((value) => value + 1)}
          onPreview={(index) => {
            const item = data?.items[index];
            if (item) void openWallpaperPreview({ item, page, kind, sort, index });
          }}
          onApply={(item) => void openWallpaperApply(item)}
        />
      </div>

      <div className="mt-3 flex flex-none items-center justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={loading || !data?.hasPrev}
          onClick={() => setPage(page - 1)}
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
          onClick={() => setPage(page + 1)}
        >
          {t("wallpaper.next")}
        </Button>
      </div>
    </div>
  );
}
