import { useState } from "react";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { ActionBar, Button, Note, Row, SectionHead, Select, type Option } from "@/settings/components/controls";
import { AppIconPicker } from "@/settings/components/appIconPicker";
import { fontOptions, themeOptions } from "@/settings/options";
import { applyAppIcon, appIconUrl } from "@/settings/appIcons";

const SIZE_OPTIONS: Option<string>[] = ["10", "12", "14", "16", "18", "20"].map((size) => ({
  value: size,
  label: size
}));

export function AppearanceSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);

  const reportIconError = (error: string | null) => {
    setIconError(error === "canceled" ? t("appearance.iconCanceled") : error);
  };

  const reset = () => {
    const defaults = defaultConfig().appearance;
    updateConfig({ appearance: defaults });
    void applyAppIcon(defaults.appIcon).then(reportIconError);
  };

  const pickIcon = (appIcon: string) => {
    updateConfig({ appearance: { ...config.appearance, appIcon } });
    setPickerOpen(false);
    void applyAppIcon(appIcon).then(reportIconError);
  };

  return (
    <>
      <SectionHead title={t("appearance.title")} />
      <Row label={t("appearance.iconLabel")} description={t("appearance.iconDesc")}>
        <button
          type="button"
          className="grid h-14 w-14 place-items-center rounded-lg border p-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t("appearance.iconTooltip")}
          aria-label={t("aria.appIcon")}
          onClick={() => {
            setIconError(null);
            setPickerOpen(true);
          }}
        >
          <img
            src={appIconUrl(config.appearance.appIcon)}
            alt=""
            draggable={false}
            className="h-full w-full object-cover object-top [image-rendering:pixelated]"
          />
        </button>
      </Row>
      {iconError ? <Note tone="warning">{iconError}</Note> : null}
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
      <ActionBar>
        <Button onClick={reset}>{t("common.restoreDefaults")}</Button>
      </ActionBar>
      {pickerOpen ? (
        <AppIconPicker
          value={config.appearance.appIcon}
          t={t}
          onPick={pickIcon}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>
  );
}
