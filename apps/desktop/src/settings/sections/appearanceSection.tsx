import { useState } from "react";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { Button, Card, Row, SectionHead, Select, type Option } from "@/settings/components/controls";
import { TrayIconPicker } from "@/settings/components/trayIconPicker";
import { fontOptions, themeOptions } from "@/settings/options";
import { applyTrayIcon, trayIconUrl } from "@/settings/trayIcons";

const SIZE_OPTIONS: Option<string>[] = ["10", "12", "14", "16", "18", "20"].map((size) => ({
  value: size,
  label: size
}));

export function AppearanceSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [pickerOpen, setPickerOpen] = useState(false);

  const reset = () => {
    const defaults = defaultConfig().appearance;
    updateConfig({ appearance: defaults });
    void applyTrayIcon(defaults.trayIcon);
  };

  const pickIcon = (trayIcon: string) => {
    updateConfig({ appearance: { ...config.appearance, trayIcon } });
    void applyTrayIcon(trayIcon);
    setPickerOpen(false);
  };

  return (
    <>
      <SectionHead title={t("appearance.title")} />
      <Row label={t("appearance.iconLabel")} description={t("appearance.iconDesc")}>
        <button
          type="button"
          className="tray-icon-button"
          title={t("appearance.iconTooltip")}
          aria-label={t("aria.trayIcon")}
          onClick={() => setPickerOpen(true)}
        >
          <img src={trayIconUrl(config.appearance.trayIcon)} alt="" draggable={false} />
        </button>
      </Row>
      <Row label={t("appearance.themeLabel")} description={t("appearance.themeDesc")}>
        <Select
          value={config.appearance.theme}
          options={themeOptions(t)}
          ariaLabel={t("aria.theme")}
          onChange={(theme) => updateConfig({ appearance: { ...config.appearance, theme } })}
        />
      </Row>
      <Row label={t("appearance.fontLabel")} description={t("appearance.fontDesc")}>
        <Select
          value={config.appearance.font}
          options={fontOptions(t)}
          ariaLabel={t("aria.font")}
          onChange={(font) => updateConfig({ appearance: { ...config.appearance, font } })}
        />
      </Row>
      <Row label={t("appearance.fontSizeLabel")} description={t("appearance.fontSizeDesc")}>
        <Select
          value={String(config.appearance.fontSize)}
          options={SIZE_OPTIONS}
          ariaLabel={t("aria.fontSize")}
          onChange={(size) =>
            updateConfig({ appearance: { ...config.appearance, fontSize: Number(size) } })
          }
        />
      </Row>
      <Card className="action-card">
        <Button onClick={reset}>{t("common.restoreDefaults")}</Button>
      </Card>
      {pickerOpen ? (
        <TrayIconPicker
          value={config.appearance.trayIcon}
          t={t}
          onPick={pickIcon}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>
  );
}
