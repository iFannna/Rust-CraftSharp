import { updateConfig, type BossBarConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import {
  ActionBar,
  Button,
  Card,
  Check,
  Note,
  NumberField,
  Select,
  TextField,
  Toggle
} from "@/settings/components/controls";
import { bossBarColorOptions, bossBarNotchOptions, dataMappingOptions } from "@/settings/options";

function newBossBar(name: string): BossBarConfig {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Date.now().toString(36);
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

export function BossBarCardContent() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const bars = config.bossBars;

  const patch = (id: string, next: Partial<BossBarConfig>) => {
    updateConfig({ bossBars: bars.map((bar) => (bar.id === id ? { ...bar, ...next } : bar)) });
  };

  return (
    <>
      {bars.length === 0 ? <Note>{t("bossBar.empty")}</Note> : null}

      {bars.map((bar) => (
        <Card key={bar.id} className="mb-3 space-y-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">{bar.name.trim() || t("bossBar.untitled")}</span>
            <div className="flex items-center gap-3">
              <Check
                label={t("bossBar.enable")}
                checked={bar.enabled}
                onChange={(enabled) => patch(bar.id, { enabled })}
              />
              <Button
                variant="danger"
                onClick={() => updateConfig({ bossBars: bars.filter((item) => item.id !== bar.id) })}
              >
                {t("bossBar.delete")}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("bossBar.name")}</span>
              <TextField
                value={bar.name}
                ariaLabel={t("aria.bossName")}
                placeholder={t("bossBar.namePlaceholder")}
                onChange={(name) => patch(bar.id, { name })}
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("bossBar.color")}</span>
              <Select
                value={bar.color}
                options={bossBarColorOptions(t)}
                ariaLabel={t("aria.bossColor")}
                onChange={(color) => patch(bar.id, { color })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("bossBar.notch")}</span>
              <Select
                value={bar.notch ?? ""}
                options={bossBarNotchOptions(t)}
                ariaLabel={t("aria.bossNotch")}
                onChange={(notch) => patch(bar.id, { notch: notch === "" ? null : (notch as BossBarConfig["notch"]) })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("hud.dataMapping")}</span>
              <div className="flex items-center gap-2">
                <Toggle
                  checked={bar.dataMappingEnabled}
                  label={t("aria.enableMapping")}
                  onChange={(dataMappingEnabled) => patch(bar.id, { dataMappingEnabled })}
                />
                <Select
                  value={bar.dataMappingType}
                  options={dataMappingOptions(t)}
                  disabled={!bar.dataMappingEnabled}
                  ariaLabel={t("hud.dataMappingType")}
                  onChange={(dataMappingType) => patch(bar.id, { dataMappingType })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("hud.customValue")}</span>
              <div className="flex items-center gap-2">
                <Toggle
                  checked={bar.customValueEnabled}
                  label={t("aria.enableCustom")}
                  onChange={(customValueEnabled) => patch(bar.id, { customValueEnabled })}
                />
                <NumberField
                  value={bar.currentValue}
                  min={0}
                  max={100}
                  ariaLabel={t("hud.customValue")}
                  disabled={!bar.customValueEnabled}
                  onChange={(currentValue) => patch(bar.id, { currentValue })}
                />
              </div>
            </div>
          </div>
        </Card>
      ))}

      <ActionBar>
        <Button primary onClick={() => updateConfig({ bossBars: [...bars, newBossBar(t("bossBar.defaultName"))] })}>
          {t("bossBar.add")}
        </Button>
      </ActionBar>
    </>
  );
}
