/** 壁纸预览窗口：当前页翻页、缩放拖拽、下载与跳转设置 */

import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig } from "@/config/appConfig";
import { tOf } from "@/i18n";
import { installLocalHotkeys } from "@/lib/localHotkeys";
import { useRevealWindow } from "@/lib/windowReveal";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { applyWindowTitle } from "@/lib/windowTitle";
import { exportWallpaper, listWallpapers, pickSavePath, type WallpaperItem } from "@/settings/wallpaper/api";
import { WallpaperViewer } from "@/settings/wallpaper/preview";
import { Toast, useToast } from "@/settings/wallpaper/toast";
import {
  PREVIEW_EVENT,
  openWallpaperApply,
  previewRequestFromParams,
  type PreviewRequest
} from "@/settings/wallpaper/windows";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import "@/ui/styles.css";

const initial = previewRequestFromParams(new URLSearchParams(location.search));

function WallpaperPreviewWindow() {
  useRevealWindow();
  const t = tOf(getConfig().system.language);
  const { message, show } = useToast();
  const [request, setRequest] = useState<PreviewRequest>(initial);
  const [items, setItems] = useState<WallpaperItem[]>(() => (initial.item.id ? [initial.item] : []));
  const [currentId, setCurrentId] = useState(initial.item.id);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    applyWindowTitle(t("wallpaper.previewTitle"));
  }, [t]);

  // 当前页用于翻页；拉取失败时只保留入口带来的这张
  useEffect(() => {
    let cancelled = false;
    listWallpapers(request.page, request.kind, request.sort)
      .then((data) => {
        if (cancelled) return;
        const list = data.items.length ? data.items : [request.item];
        setItems(list);
        setCurrentId((id) => (list.some((item) => item.id === id) ? id : list[0].id));
      })
      .catch(() => {
        if (!cancelled) setItems([request.item]);
      });
    return () => {
      cancelled = true;
    };
  }, [request.page, request.kind, request.sort]);

  // 设置页再次点开其他壁纸时复用本窗口
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void listen<PreviewRequest>(PREVIEW_EVENT, (event) => {
      if (cancelled) return;
      setRequest(event.payload);
      setCurrentId(event.payload.item.id);
      setItems((list) =>
        list.some((item) => item.id === event.payload.item.id) ? list : [event.payload.item]
      );
    }).then((off) => {
      if (cancelled) off();
      else dispose = off;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  const index = items.findIndex((item) => item.id === currentId);
  const current = index >= 0 ? items[index] : request.item;
  const total = Math.max(items.length, 1);

  const step = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= items.length) return;
    setCurrentId(items[next].id);
  };

  const download = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const path = await pickSavePath(current.title);
      if (path) {
        await exportWallpaper(current.id, path);
        show(t("wallpaper.downloadSuccess"));
      }
    } catch (reason) {
      show(t("wallpaper.downloadFailed", { reason: String(reason) }));
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    void getCurrentWindow().close().catch(() => undefined);
  };

  return (
    <ThemeRoot>
      <WindowFrame
        title={t("wallpaper.previewTitle")}
        controls="full"
        resizable
        onClose={close}
      >
        <WallpaperViewer
          item={current}
          index={index}
          total={total}
          saving={saving}
          t={t}
          onClose={close}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onDownload={() => void download()}
          onApply={() => void openWallpaperApply(current, WINDOW_LABEL.wallpaperPreview)}
        />
        <Toast message={message} />
      </WindowFrame>
    </ThemeRoot>
  );
}

installLocalHotkeys({ local: false });
ReactDOM.createRoot(document.getElementById("root")!).render(<WallpaperPreviewWindow />);
