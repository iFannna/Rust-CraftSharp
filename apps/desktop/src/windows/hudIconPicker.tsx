import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { getConfig } from "@/config/appConfig";
import type { HudElementId } from "@/config/appConfig";
import { tOf } from "@/i18n";
import { emitDialogResult } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { elementIconUrls } from "@/hud/statusbar/iconStyles";
import { iconStyleOptions } from "@/hud/statusbar/iconStyleOptions";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip";
import { cn } from "@/ui/lib/utils";
import "@/ui/styles.css";

const params = new URLSearchParams(location.search);

const ICON_BUTTON =
  "grid h-16 w-16 flex-none place-items-center overflow-hidden rounded-sm bg-secondary/60 transition-colors hover:bg-accent";
const ICON_SELECTED = "bg-accent ring-1 ring-inset ring-ring";

function HudIconPicker() {
  const t = tOf(getConfig().system.language);
  const element = (params.get("element") ?? "health") as HudElementId;
  const value = params.get("value") ?? "";
  const options = iconStyleOptions(element) ?? [];
  const vertical = element === "expBar";

  const finish = (style: string | null) => emitDialogResult(WINDOW_LABEL.hudIconPicker, style);

  useEffect(() => {
    document.title = t("hudIconPicker.title");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ThemeRoot>
      <WindowFrame title={t("hudIconPicker.title")} resizable onClose={() => finish(null)}>
        <div className="ui-scroll min-h-0 flex-1 overflow-y-auto p-4">
          {vertical ? (
            <div className="flex flex-col items-stretch gap-2">
              {options.map((option) => {
                const urls = elementIconUrls(element, option.value);
                return (
                  <Tooltip key={option.value}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "flex min-h-8 w-full items-center overflow-hidden rounded-sm bg-secondary/60 px-2 py-2 transition-colors hover:bg-accent",
                          option.value === value && ICON_SELECTED
                        )}
                        aria-label={t(option.labelKey)}
                        onClick={() => finish(option.value)}
                      >
                        <img
                          src={urls.icon}
                          alt=""
                          draggable={false}
                          className="w-full object-contain [image-rendering:pixelated]"
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t(option.labelKey)}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ) : (
            <div className="grid content-start justify-center gap-2 [grid-template-columns:repeat(auto-fill,64px)]">
              {options.map((option) => {
                const urls = elementIconUrls(element, option.value);
                return (
                  <Tooltip key={option.value}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(ICON_BUTTON, option.value === value && ICON_SELECTED)}
                        aria-label={t(option.labelKey)}
                        onClick={() => finish(option.value)}
                      >
                        <span className="relative grid h-12 w-12 place-items-center">
                          {urls.background ? (
                            <img
                              src={urls.background}
                              alt=""
                              draggable={false}
                              className="absolute inset-0 h-full w-full object-contain [image-rendering:pixelated]"
                            />
                          ) : null}
                          <img
                            src={urls.icon}
                            alt=""
                            draggable={false}
                            className="relative h-full w-full object-contain [image-rendering:pixelated]"
                          />
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t(option.labelKey)}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
      </WindowFrame>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<HudIconPicker />);
