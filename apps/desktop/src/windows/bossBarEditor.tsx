import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { getConfig, type BossBarConfig } from "@/config/appConfig";
import { tOf } from "@/i18n";
import { emitDialogResult } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { bossBarNotchProgress, bossBarProgress } from "@/hud/bossbar/bossBarAssets";
import {
  bossBarColorOptions,
  bossBarNotchOptions,
  dataMappingOptions
} from "@/settings/options";
import { Button, NumberField, Select, TextField, Toggle } from "@/settings/components/controls";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import "@/ui/styles.css";

const params = new URLSearchParams(location.search);

function newBossBar(name: string): BossBarConfig {
  const suffix =
    typeof crypto.randomUUID === "function" ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36);
  return {
    id: `boss_${suffix}`,
    name,
    color: "blue",
    notch: null,
    enabled: true,
    dataMappingEnabled: false,
    dataMappingType: "battery",
    customValueEnabled: true,
    currentValue: 100
  };
}

function BossBarEditor() {
  const t = tOf(getConfig().system.language);
  const [bar, setBar] = useState<BossBarConfig>(() => {
    const id = params.get("id");
    const existing = id ? getConfig().bossBars.find((item) => item.id === id) : undefined;
    return existing ?? newBossBar(t("bossBar.defaultName"));
  });

  const finish = (value: BossBarConfig | null) => emitDialogResult(WINDOW_LABEL.bossBarEditor, value);

  useEffect(() => {
    document.title = t("bossBar.editorTitle");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const patch = (next: Partial<BossBarConfig>) => setBar((current) => ({ ...current, ...next }));

  return (
    <ThemeRoot>
      <WindowFrame title={t("bossBar.editorTitle")} controls="close" onClose={() => finish(null)}>
        <div className="ui-scroll min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("bossBar.name")}</span>
              <TextField
                value={bar.name}
                ariaLabel={t("aria.bossName")}
                placeholder={t("bossBar.namePlaceholder")}
                onChange={(name) => patch({ name })}
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("bossBar.color")}</span>
              <Select
                value={bar.color}
                options={bossBarColorOptions(t)}
                ariaLabel={t("aria.bossColor")}
                onChange={(color) => patch({ color })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("bossBar.notch")}</span>
              <Select
                value={bar.notch ?? ""}
                options={bossBarNotchOptions(t)}
                ariaLabel={t("aria.bossNotch")}
                onChange={(notch) =>
                  patch({ notch: notch === "" ? null : (notch as BossBarConfig["notch"]) })
                }
              />
              <div className="relative mt-1 h-[10px] w-full overflow-hidden">
                <img
                  src={bossBarProgress(bar.color)}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-contain [image-rendering:pixelated]"
                />
                {bar.notch ? (
                  <img
                    src={bossBarNotchProgress(bar.notch)}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-contain [image-rendering:pixelated]"
                  />
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("hud.dataMapping")}</span>
              <div className="flex items-center gap-2">
                <Toggle
                  checked={bar.dataMappingEnabled}
                  label={t("aria.enableMapping")}
                  onChange={(dataMappingEnabled) => patch({ dataMappingEnabled })}
                />
                <Select
                  value={bar.dataMappingType}
                  options={dataMappingOptions(t)}
                  disabled={!bar.dataMappingEnabled}
                  ariaLabel={t("hud.dataMappingType")}
                  onChange={(dataMappingType) => patch({ dataMappingType })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("hud.customValue")}</span>
              <div className="flex items-center gap-2">
                <Toggle
                  checked={bar.customValueEnabled}
                  label={t("aria.enableCustom")}
                  onChange={(customValueEnabled) => patch({ customValueEnabled })}
                />
                <NumberField
                  value={bar.currentValue}
                  min={0}
                  max={100}
                  ariaLabel={t("hud.customValue")}
                  disabled={!bar.customValueEnabled}
                  onChange={(currentValue) => patch({ currentValue })}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-none justify-end gap-2 border-t p-4">
          <Button onClick={() => finish(null)}>{t("common.cancel")}</Button>
          <Button primary onClick={() => finish(bar)}>
            {t("bossBar.save")}
          </Button>
        </div>
      </WindowFrame>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<BossBarEditor />);
