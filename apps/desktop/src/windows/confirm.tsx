import { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig } from "@/config/appConfig";
import { emitDialogResult } from "@/lib/dialogWindow";
import { isTauri } from "@/lib/runtime";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { applyWindowTitle } from "@/lib/windowTitle";
import { tOf } from "@/i18n";
import { Button } from "@/ui/components/button";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import "@/ui/styles.css";

const params = new URLSearchParams(location.search);

/** 标准确认窗高度，减掉一行文本高度后作为最小高度 */
const BASE_HEIGHT = 190;
const SCREEN_MARGIN = 24;

function ConfirmDialog() {
  const textRef = useRef<HTMLParagraphElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const t = tOf(getConfig().system.language);
  const kind = params.get("kind") === "alert" ? "alert" : "confirm";
  const text = params.get("text") ?? "";
  const title = params.get("title") ?? t("dialog.alertTitle");
  const confirmLabel = params.get("confirmLabel") ?? t(kind === "confirm" ? "common.confirm" : "common.ok");
  // alert 默认只有确定键，传入 cancelLabel 时显示自定义取消键
  const cancelLabel = params.get("cancelLabel") ?? (kind === "confirm" ? t("common.cancel") : null);
  const finish = (value: boolean) => emitDialogResult(WINDOW_LABEL.confirm, value);

  // 先按内容调整高度再显示，避免窗口先以旧高度出现再跳动
  useEffect(() => {
    if (!isTauri()) return;
    const current = getCurrentWindow();
    const textEl = textRef.current;
    const bodyEl = bodyRef.current;
    if (!textEl || !bodyEl) {
      void current.show().then(() => current.setFocus()).catch(() => undefined);
      return;
    }

    let cancelled = false;
    const fit = async () => {
      const lineHeight = Number.parseFloat(getComputedStyle(textEl).lineHeight) || 24;
      const minHeight = BASE_HEIGHT - lineHeight;
      const header = document.querySelector("header");
      const container = textEl.parentElement;
      const footer = textEl.nextElementSibling as HTMLElement | null;
      const containerStyle = container ? getComputedStyle(container) : null;
      const footerStyle = footer ? getComputedStyle(footer) : null;
      const chrome =
        (header?.offsetHeight || 32) +
        (Number.parseFloat(containerStyle?.paddingTop ?? "") || 20) +
        (Number.parseFloat(containerStyle?.paddingBottom ?? "") || 20) +
        (footer?.offsetHeight || 36) +
        (Number.parseFloat(footerStyle?.marginTop ?? "") || 16);
      const wanted = Math.max(minHeight, chrome + bodyEl.offsetHeight);
      const maxHeight = Math.max(minHeight, window.screen.availHeight - SCREEN_MARGIN);
      const height = Math.min(wanted, maxHeight);
      const [scale, inner] = await Promise.all([current.scaleFactor(), current.innerSize()]);
      const width = inner.width / scale;

      await current.setSize(new LogicalSize(width, height));
      if (cancelled) return;
      await current.show();
      await current.setFocus();
    };

    void fit().catch(() => {
      void current.show().then(() => current.setFocus()).catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyWindowTitle(title);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const destructive = kind === "confirm";

  return (
    <ThemeRoot>
      <WindowFrame title={title} controls="close" onClose={() => finish(false)}>
        <div className="flex min-h-0 flex-1 flex-col p-5">
          <p
            ref={textRef}
            className="ui-scroll-auto min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90"
          >
            <span ref={bodyRef} className="block">
              {text}
            </span>
          </p>
          <div className="mt-4 flex flex-none justify-end gap-2">
            {cancelLabel ? (
              <Button autoFocus={kind === "confirm"} type="button" variant="outline" onClick={() => finish(false)}>
                {cancelLabel}
              </Button>
            ) : null}
            <Button
              autoFocus={kind === "alert"}
              type="button"
              variant={destructive ? "destructive" : "default"}
              onClick={() => finish(true)}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </WindowFrame>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<ConfirmDialog />);
