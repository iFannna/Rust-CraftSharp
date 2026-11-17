import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { getConfig, type BossBarConfig } from "@/config/appConfig";
import { tOf } from "@/i18n";
import { emitDialogResult } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { bossBarNotchProgress, bossBarProgress } from "@/hud/bossbar/bossBarAssets";
import { dataMappingOptions } from "@/settings/options";
import { Button, NumberField, Select, TextField, Toggle } from "@/settings/components/controls";
import { HudIconButton } from "@/settings/sections/hud/iconPickerButton";
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

const PREVIEW_BOX = "flex h-8 w-full items-center overflow-hidden rounded-sm bg-secondary/60 px-2";

function PreviewBar({ color, notch }: { color: string; notch?: string | null }) {
  return (
    <span className="relative block h-full w-full">
      <img
        src={bossBarProgress(color)}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain [image-rendering:pixelated]"
      />
      {notch ? (
        <img
          src={bossBarNotchProgress(notch)}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain [image-rendering:pixelated]"
        />
      ) : null}
    </span>
  );
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
              <HudIconButton
                element="boss_bar"
                value={bar.color}
                topMost
                className={PREVIEW_BOX}
                onPicked={(color) => patch({ color: color as BossBarConfig["color"] })}
              >
                <PreviewBar color={bar.color} />
              </HudIconButton>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("bossBar.notch")}</span>
              <HudIconButton
                element="boss_bar_notch"
                value={bar.notch ?? ""}
                topMost
                className={PREVIEW_BOX}
                onPicked={(notch) =>
                  patch({ notch: notch === "" ? null : (notch as BossBarConfig["notch"]) })
                }
              >
                <PreviewBar color={bar.color} notch={bar.notch} />
              </HudIconButton>
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
                <span className="text-xs text-muted-foreground">/100</span>
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
