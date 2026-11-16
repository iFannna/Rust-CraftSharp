import { useState } from "react";
import { getConfig, updateConfig, defaultConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { openDialogWindow } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { tOf } from "@/i18n";
import { ActionBar, Button, Note, Row, SectionHead, Select, type Option } from "@/settings/components/controls";
import { fontOptions, themeOptions } from "@/settings/options";
import { applyAppIcon, appIconUrl } from "@/settings/appIcons";

const SIZE_OPTIONS: Option<string>[] = ["10", "12", "14", "16", "18", "20"].map((size) => ({
  value: size,
  label: size
}));

export function AppearanceSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [iconError, setIconError] = useState<string | null>(null);

  const reportIconError = (error: string | null) => {
    setIconError(error === "canceled" ? t("appearance.iconCanceled") : error);
  };

  const reset = () => {
    const defaults = defaultConfig().appearance;
    updateConfig({ appearance: defaults });
    void applyAppIcon(defaults.appIcon).then(reportIconError);
  };

  const openIconPicker = async () => {
    setIconError(null);
    const picked = await openDialogWindow<string>({
      label: WINDOW_LABEL.iconPicker,
      title: t("iconPicker.title"),
      page: "icon-picker",
      params: { value: config.appearance.appIcon },
      width: 900,
      height: 680,
      minWidth: 640,
      minHeight: 480,
      mode: "display",
      anchor: WINDOW_LABEL.settings
    });
    if (picked === null) return;
    updateConfig({ appearance: { ...getConfig().appearance, appIcon: picked } });
    void applyAppIcon(picked).then(reportIconError);
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
          onClick={() => void openIconPicker()}
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
    </>
  );
}
