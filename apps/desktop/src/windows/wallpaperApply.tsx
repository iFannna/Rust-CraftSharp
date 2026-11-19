/** 壁纸设置窗口：模式、显示器与拼接设置，应用后写回配置 */

import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig, type WallpaperEntry } from "@/config/appConfig";
import { tOf } from "@/i18n";
import { installLocalHotkeys } from "@/lib/localHotkeys";
import { useRevealWindow } from "@/lib/windowReveal";
import { applyWindowTitle } from "@/lib/windowTitle";
import {
  fetchMonitors,
  type SpanTransform,
  type WallpaperItem,
  type WallpaperMode,
  type WallpaperMonitor
} from "@/settings/wallpaper/api";
import { applyWallpaper, DEFAULT_SPAN } from "@/settings/wallpaper/apply";
import { useWallpaperSession } from "@/settings/wallpaper/session";
import { WallpaperApplyPanel } from "@/settings/wallpaper/targets";
import { APPLY_EVENT, itemFromParams } from "@/settings/wallpaper/windows";
import { Toaster } from "@/ui/components/sonner";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import "@/ui/styles.css";

const initialItem = itemFromParams(new URLSearchParams(location.search));

/** 已设置的显示器优先，否则默认主屏 */
function initialSelection(monitors: WallpaperMonitor[], saved: Record<string, WallpaperEntry>) {
  const present = Object.keys(saved).filter((path) =>
    monitors.some((monitor) => monitor.devicePath === path)
  );
  if (present.length) return present;
  const primary = monitors.find((monitor) => monitor.primary) ?? monitors[0];
  return primary ? [primary.devicePath] : [];
}

function WallpaperApplyWindow() {
  useRevealWindow();
  const t = tOf(getConfig().system.language);
  const { session } = useWallpaperSession(() =>
    toast.success(t("wallpaper.loginSuccess"))
  );
  const [item, setItem] = useState<WallpaperItem>(initialItem);
  const [monitors, setMonitors] = useState<WallpaperMonitor[] | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const closeTimer = useRef(0);
  busyRef.current = busy;

  useEffect(() => {
    applyWindowTitle(t("wallpaper.setWallpaper"));
  }, [t]);

  useEffect(() => {
    void fetchMonitors()
      .then(setMonitors)
      .catch(() => setMonitors([]));
  }, []);

  // 设置页再次点开其他壁纸时复用本窗口
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void listen<WallpaperItem>(APPLY_EVENT, (event) => {
      if (cancelled || busyRef.current) return;
      setItem(event.payload);
    }).then((off) => {
      if (cancelled) off();
      else dispose = off;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const close = () => {
    if (busyRef.current) return;
    void getCurrentWindow().close().catch(() => undefined);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const apply = async (mode: WallpaperMode, selected: string[], transform: SpanTransform) => {
    if (busyRef.current) return;
    if (item.kind === "dynamic" && !session) {
      toast.info(t("wallpaper.dynamicLogin"));
      return;
    }
    if (mode === "independent" && !selected.length) {
      toast.info(t("wallpaper.noMonitor"));
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const result = await applyWallpaper(item, mode, selected, transform, monitors ?? []);
      if (result.warnings.length) {
        toast.info(t("wallpaper.setPartial", { count: result.warnings.length }));
      } else {
        toast.success(t("wallpaper.setSuccess"));
      }
      closeTimer.current = window.setTimeout(
        () => void getCurrentWindow().close().catch(() => undefined),
        result.warnings.length ? 1600 : 900
      );
    } catch (reason) {
      busyRef.current = false;
      setBusy(false);
      toast.error(t("wallpaper.applyFailed", { reason: String(reason) }));
    }
  };

  const config = getConfig();

  return (
    <ThemeRoot>
      <WindowFrame title={t("wallpaper.setWallpaper")} controls="full" resizable onClose={close}>
        {monitors ? (
          <WallpaperApplyPanel
            key={item.id}
            item={item}
            monitors={monitors}
            initialMode={config.wallpaper.mode}
            initialSelected={initialSelection(monitors, config.wallpaper.monitors)}
            initialTransform={config.wallpaper.transforms[item.id] ?? DEFAULT_SPAN}
            busy={busy}
            t={t}
            onClose={close}
            onApply={(mode, selected, transform) => void apply(mode, selected, transform)}
          />
        ) : (
          <div className="grid flex-1 place-items-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
              {t("wallpaper.loading")}
            </div>
          </div>
        )}

        <Toaster />
      </WindowFrame>
    </ThemeRoot>
  );
}

installLocalHotkeys({ local: false });
ReactDOM.createRoot(document.getElementById("root")!).render(<WallpaperApplyWindow />);
