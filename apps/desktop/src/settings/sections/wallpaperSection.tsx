/** 壁纸页：筛选、排序、分页、预览，以及同步/单独/拼接三种应用方式 */

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf, type MessageKey } from "@/i18n";
import { isTauri } from "@/lib/runtime";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";
import { Card, SectionHead, Select, type Option } from "@/settings/components/controls";
import {
  applyLayout,
  captureSession,
  exportWallpaper,
  fetchMonitors,
  listWallpapers,
  logout,
  pickSavePath,
  sessionStatus,
  type ApplyPlan,
  type SpanTransform,
  type WallpaperItem,
  type WallpaperKind,
  type WallpaperMode,
  type WallpaperMonitor,
  type WallpaperPage,
  type WallpaperSort
} from "@/settings/wallpaper/api";
import { WallpaperGrid } from "@/settings/wallpaper/grid";
import { WallpaperPreview } from "@/settings/wallpaper/preview";
import { WallpaperTargets } from "@/settings/wallpaper/targets";
import { Toast, useToast } from "@/settings/wallpaper/toast";

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



const DEFAULT_SPAN: SpanTransform = { zoom: 1, offsetX: 0, offsetY: 0 };

export function WallpaperSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const { message: toastMessage, show: showToast } = useToast();

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
  const [monitors, setMonitors] = useState<WallpaperMonitor[]>([]);
  const [session, setSession] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [targetsItem, setTargetsItem] = useState<WallpaperItem | null>(null);


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

  useEffect(() => {
    if (!isTauri()) return;
    void fetchMonitors()
      .then((list) => setMonitors(list))
      .catch(() => setMonitors([]));
    void sessionStatus()
      .then(setSession)
      .catch(() => setSession(false));
  }, []);


  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void listen<boolean>("wallpaper:session", (event) => {
      if (cancelled) return;
      setSession(event.payload);
      setCapturing(false);
      showToast(t(event.payload ? "wallpaper.loginSuccess" : "wallpaper.loginFailed"));
    }).then((off) => {
      if (cancelled) off();
      else dispose = off;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [showToast, t]);

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

  const initialSelected = () => {
    const saved = Object.keys(config.wallpaper.monitors).filter((path) =>
      monitors.some((monitor) => monitor.devicePath === path)
    );
    if (saved.length) return saved;
    const primary = monitors.find((monitor) => monitor.primary) ?? monitors[0];
    return primary ? [primary.devicePath] : [];
  };

  const applyWithTargets = async (
    item: WallpaperItem,
    mode: WallpaperMode,
    selected: string[],
    transform: SpanTransform
  ) => {
    if (applyingId) return;
    if (item.kind === "dynamic" && !session) {
      showToast(t("wallpaper.dynamicLogin"));
      return;
    }
    if (mode === "independent" && !selected.length) {
      showToast(t("wallpaper.noMonitor"));
      return;
    }

    setApplyingId(item.id);
    try {
      const entry = { id: item.id, type: item.kind } as const;
      let plan: ApplyPlan;
      let commit: () => void;

      if (mode === "span") {
        plan = { mode, monitors: [], span: { entry, transform } };
        commit = () =>
          updateConfig({
            wallpaper: {
              mode,
              span: {
                id: item.id,
                title: item.title,
                type: item.kind,
                localPath: "",
                previewPath: item.previewUrl
              },
              transforms: { ...config.wallpaper.transforms, [item.id]: transform }
            }
          });
      } else if (mode === "independent") {
        const monitorsMap = { ...config.wallpaper.monitors };
        for (const device of selected) {
          monitorsMap[device] = {
            id: item.id,
            title: item.title,
            type: item.kind,
            localPath: "",
            previewPath: item.previewUrl
          };
        }
        const targets = Object.entries(monitorsMap)
          .filter(([device]) => monitors.some((monitor) => monitor.devicePath === device))
          .map(([monitor, entry]) => ({
            monitor,
            entry: { id: entry.id, type: entry.type }
          }));
        plan = { mode, monitors: targets };
        commit = () => updateConfig({ wallpaper: { mode, monitors: monitorsMap } });
      } else {
        plan = { mode: "sync", sync: entry, monitors: [] };
        commit = () =>
          updateConfig({
            wallpaper: {
              mode: "sync",
              currentId: item.id,
              title: item.title,
              type: item.kind,
              localPath: ""
            }
          });
      }

      const result = await applyLayout(plan);
      commit();
      if (result.warnings.length) {
        showToast(t("wallpaper.setPartial", { count: result.warnings.length }));
      } else {
        showToast(t("wallpaper.setSuccess"));
      }
    } catch (reason) {
      showToast(t("wallpaper.applyFailed", { reason: String(reason) }));
    } finally {
      setApplyingId(null);
      setTargetsItem(null);
    }
  };

  const applyItem = async (item: WallpaperItem) => {
    if (applyingId) return;
    if (item.kind === "dynamic" && !session) {
      showToast(t("wallpaper.dynamicLogin"));
      return;
    }
    const list = monitors.length > 1 ? monitors : await fetchMonitors().catch(() => monitors);
    if (list.length > 1) {
      setMonitors(list);
      setPreview(null);
      setTargetsItem(item);
      return;
    }
    void applyWithTargets(item, "sync", [], DEFAULT_SPAN);
  };

  const download = async (item: WallpaperItem) => {
    if (savingId !== null) return;
    setSavingId(item.id);
    try {
      const path = await pickSavePath(item.title);
      if (path) {
        await exportWallpaper(item.id, path);
        showToast(t("wallpaper.downloadSuccess"));
      }
    } catch (reason) {
      showToast(t("wallpaper.downloadFailed", { reason: String(reason) }));
    } finally {
      setSavingId(null);
    }
  };

  const openLogin = async () => {
    if (!isTauri()) return;
    const existing = await WebviewWindow.getByLabel(WINDOW_LABEL.wallpaperLogin).catch(() => null);
    if (existing) {
      await existing.show().catch(() => undefined);
      await existing.setFocus().catch(() => undefined);
      return;
    }
    const window = new WebviewWindow(WINDOW_LABEL.wallpaperLogin, {
      url: "https://mcblock.top/wallpapers",
      title: t("wallpaper.loginTitle"),
      width: 1100,
      height: 760,
      center: true,
      resizable: true
    });
    void window.once("tauri://error", () => showToast(t("wallpaper.loginFailed")));
  };

  const finishLogin = async () => {
    if (!isTauri()) return;
    setCapturing(true);
    const timer = window.setTimeout(() => setCapturing(false), 6000);
    try {
      await captureSession();
    } catch (reason) {
      window.clearTimeout(timer);
      setCapturing(false);
      showToast(t("wallpaper.applyFailed", { reason: String(reason) }));
    }
  };

  const signOut = async () => {
    await logout().catch(() => undefined);
    setSession(false);
  };

  const sortOptions: Option<WallpaperSort>[] = SORTS.map((item) => ({
    value: item.value,
    label: t(item.key)
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SectionHead title={t("wallpaper.title")} />

      <div className="mb-2 flex flex-none items-center gap-3">
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

      <div className="mb-3 flex flex-none flex-wrap items-center gap-2 text-xs">
        {isTauri() ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground">
              {session ? t("wallpaper.loggedIn") : t("wallpaper.loggedOut")}
            </span>
            {session ? (
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                {t("wallpaper.logout")}
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => void openLogin()}>
                  {t("wallpaper.login")}
                </Button>
                <Button variant="outline" size="sm" disabled={capturing} onClick={() => void finishLogin()}>
                  {capturing ? t("wallpaper.capturing") : t("wallpaper.loginDone")}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>

      <Card className="relative min-h-0 flex-1 overflow-hidden">
        <WallpaperGrid
          items={data?.items ?? []}
          loading={loading}
          error={error}
          applyingId={applyingId}
          dynamicEnabled={session}
          t={t}
          onRetry={() => setReload((value) => value + 1)}
          onPreview={setPreview}
          onApply={(item) => void applyItem(item)}
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
          dynamicEnabled={session}
          t={t}
          onClose={() => setPreview(null)}
          onIndexChange={setPreview}
          onApply={(item) => void applyItem(item)}
          onDownload={(item) => void download(item)}
        />
      ) : null}

      {targetsItem ? (
        <WallpaperTargets
          item={targetsItem}
          monitors={monitors}
          initialMode={config.wallpaper.mode}
          initialSelected={initialSelected()}
          initialTransform={config.wallpaper.transforms[targetsItem.id] ?? DEFAULT_SPAN}
          t={t}
          onClose={() => setTargetsItem(null)}
          onApply={(mode, selected, transform) =>
            void applyWithTargets(targetsItem, mode, selected, transform)
          }
        />
      ) : null}

      <Toast message={toastMessage} />
    </div>
  );
}
