import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { getConfig } from "@/config/appConfig";
import { containerStyleUrl } from "@/hud/inventory/stylePreviewAssets";
import { CONTAINER_STYLES } from "@/hud/inventory/styles";
import { tOf } from "@/i18n";
import { emitDialogResult } from "@/lib/dialogWindow";
import { installLocalHotkeys } from "@/lib/localHotkeys";
import { useRevealWindow } from "@/lib/windowReveal";
import { applyWindowTitle } from "@/lib/windowTitle";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { ChevronLeftIcon, ChevronRightIcon } from "@/ui/icons";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import "@/ui/styles.css";

const params = new URLSearchParams(location.search);

function StylePreview() {
  useRevealWindow();
  const t = tOf(getConfig().system.language);
  const initial = Math.max(
    0,
    CONTAINER_STYLES.findIndex((style) => style.file === (params.get("value") ?? ""))
  );
  const [index, setIndex] = useState(initial);
  const current = CONTAINER_STYLES[index];

  const finish = (file: string | null) => emitDialogResult(WINDOW_LABEL.stylePreview, file);

  useEffect(() => {
    applyWindowTitle(t("inventory.stylePreviewTitle"));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((value) => Math.max(0, value - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((value) => Math.min(CONTAINER_STYLES.length - 1, value + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ThemeRoot>
      <WindowFrame title={t("inventory.stylePreviewTitle")} controls="close" onClose={() => finish(null)}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-stretch gap-2 px-4 pt-3">
            <button
              type="button"
              className="grid h-8 w-8 flex-none self-center place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              aria-label={t("aria.stylePreviewPrev")}
              disabled={index === 0}
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
            >
              <ChevronLeftIcon size={16} />
            </button>

            <button
              type="button"
              className="grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden rounded-md p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("aria.stylePreviewUse")}
              autoFocus
              onClick={() => finish(current.file)}
            >
              <img
                src={containerStyleUrl(current.file)}
                alt=""
                draggable={false}
                className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
              />
            </button>

            <button
              type="button"
              className="grid h-8 w-8 flex-none self-center place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              aria-label={t("aria.stylePreviewNext")}
              disabled={index === CONTAINER_STYLES.length - 1}
              onClick={() => setIndex((value) => Math.min(CONTAINER_STYLES.length - 1, value + 1))}
            >
              <ChevronRightIcon size={16} />
            </button>
          </div>

          <div className="flex-none py-2 text-center text-sm font-medium">{t(current.nameKey)}</div>
          <div className="flex-none pb-4 text-center text-xs text-muted-foreground">
            {index + 1} / {CONTAINER_STYLES.length}
          </div>
        </div>
      </WindowFrame>
    </ThemeRoot>
  );
}

installLocalHotkeys({ local: false });
ReactDOM.createRoot(document.getElementById("root")!).render(<StylePreview />);
