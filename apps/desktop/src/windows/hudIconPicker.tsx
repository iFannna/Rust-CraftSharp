import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { getConfig } from "@/config/appConfig";
import { tOf, type TFunction } from "@/i18n";
import { emitDialogResult } from "@/lib/dialogWindow";
import { applyWindowTitle } from "@/lib/windowTitle";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { bossBarNotchProgress, bossBarProgress } from "@/hud/bossbar/bossBarAssets";
import { ATTACK_INDICATOR_ICON, CROSSHAIR_ICON } from "@/hud/statusbar/crosshairAssets";
import { elementIconUrls } from "@/hud/statusbar/iconStyles";
import { iconStyleOptions } from "@/hud/statusbar/iconStyleOptions";
import { bossBarColorOptions, bossBarNotchOptions } from "@/settings/options";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip";
import { cn } from "@/ui/lib/utils";
import "@/ui/styles.css";

const params = new URLSearchParams(location.search);

const ICON_BUTTON =
  "grid h-16 w-16 flex-none place-items-center overflow-hidden rounded-sm bg-secondary/60 transition-colors hover:bg-accent";
const ICON_SELECTED = "bg-accent ring-1 ring-inset ring-ring";

type PickerElement =
  | "health"
  | "food"
  | "air"
  | "armor"
  | "absorbing"
  | "expBar"
  | "crosshair"
  | "attackIndicator"
  | "boss_bar"
  | "boss_bar_notch";

interface PickerOption {
  value: string;
  label: string;
  icon: string;
  background?: string;
}

function buildOptions(element: PickerElement, t: TFunction): PickerOption[] {
  if (element === "crosshair") {
    return [{ value: "", label: t("hud.crosshair"), icon: CROSSHAIR_ICON }];
  }
  if (element === "attackIndicator") {
    return [{ value: "", label: t("hud.attackIndicator"), icon: ATTACK_INDICATOR_ICON }];
  }
  if (element === "boss_bar") {
    return bossBarColorOptions(t).map((option) => ({
      value: option.value,
      label: option.label,
      icon: bossBarProgress(option.value)
    }));
  }
  if (element === "boss_bar_notch") {
    return bossBarNotchOptions(t).map((option) => ({
      value: option.value,
      label: option.label,
      icon: option.value ? bossBarNotchProgress(option.value) : ""
    }));
  }
  return (iconStyleOptions(element) ?? []).map((option) => {
    const urls = elementIconUrls(element, option.value);
    return { value: option.value, label: t(option.labelKey), icon: urls.icon, background: urls.background };
  });
}

function HudIconPicker() {
  const t = tOf(getConfig().system.language);
  const element = (params.get("element") ?? "health") as PickerElement;
  const value = params.get("value") ?? "";
  const options = buildOptions(element, t);
  const vertical = element === "expBar" || element === "boss_bar" || element === "boss_bar_notch";

  const finish = (style: string | null) => emitDialogResult(WINDOW_LABEL.hudIconPicker, style);

  useEffect(() => {
    applyWindowTitle(t("hudIconPicker.title"));
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
          <div className="flex min-h-full items-center justify-center">
            {vertical ? (
              <div className="flex w-full max-w-[420px] flex-col gap-2">
                {options.map((option) => (
                  <Tooltip key={option.value}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "flex min-h-8 w-full items-center justify-center overflow-hidden rounded-sm bg-secondary/60 px-2 py-2 transition-colors hover:bg-accent",
                          option.value === value && ICON_SELECTED
                        )}
                        aria-label={option.label}
                        onClick={() => finish(option.value)}
                      >
                        {option.icon ? (
                          <img
                            src={option.icon}
                            alt=""
                            draggable={false}
                            className="w-full object-contain [image-rendering:pixelated]"
                          />
                        ) : (
                          <span className="text-sm">{option.label}</span>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{option.label}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ) : (
              <div className="flex w-fit flex-wrap content-start gap-2">
                {options.map((option) => (
                  <Tooltip key={option.value}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(ICON_BUTTON, option.value === value && ICON_SELECTED)}
                        aria-label={option.label}
                        onClick={() => finish(option.value)}
                      >
                        <span className="relative grid h-12 w-12 place-items-center">
                          {option.background ? (
                            <img
                              src={option.background}
                              alt=""
                              draggable={false}
                              className="absolute inset-0 h-full w-full object-contain [image-rendering:pixelated]"
                            />
                          ) : null}
                          <img
                            src={option.icon}
                            alt=""
                            draggable={false}
                            className="relative h-full w-full object-contain [image-rendering:pixelated]"
                          />
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{option.label}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}
          </div>
        </div>
      </WindowFrame>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<HudIconPicker />);
