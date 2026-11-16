import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { PLAYER_SKINS } from "@/entity3d/catalog";
import { tOf } from "@/i18n";
import { toggleEntityPreview } from "@/lib/windowControls";
import { Button, Card, Row, SectionHead, Select, type Option } from "@/settings/components/controls";
import { fontOptions, skinTypeOptions, themeOptions } from "@/settings/options";

const SKIN_OPTIONS: Option<string>[] = PLAYER_SKINS.map((skin) => ({ value: skin, label: skin }));

const SIZE_OPTIONS: Option<string>[] = ["10", "12", "14", "16", "18", "20"].map((size) => ({
  value: size,
  label: size
}));

export function AppearanceSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);

  const reset = () => {
    const defaults = defaultConfig().appearance;
    updateConfig({ appearance: defaults });
  };

  return (
    <>
      <SectionHead title={t("appearance.title")} />
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
      <Row label={t("appearance.skinLabel")} description={t("appearance.skinDesc")}>
        <Select
          value={config.player.skinName}
          options={SKIN_OPTIONS}
          ariaLabel={t("aria.skin")}
          onChange={(skinName) => updateConfig({ player: { ...config.player, skinName, skinPath: "" } })}
        />
      </Row>
      <Row label={t("appearance.skinTypeLabel")} description={t("appearance.skinTypeDesc")}>
        <Select
          value={config.player.skinType}
          options={skinTypeOptions(t)}
          ariaLabel={t("aria.skinType")}
          onChange={(skinType) => updateConfig({ player: { ...config.player, skinType } })}
        />
      </Row>
      <Row
        label={t("appearance.customSkinLabel")}
        description={config.player.skinPath || t("appearance.customSkinDesc")}
      >
        <Button onClick={() => void toggleEntityPreview()}>{t("appearance.openPreview")}</Button>
      </Row>
      <Card className="action-card">
        <Button onClick={reset}>{t("common.restoreDefaults")}</Button>
      </Card>
    </>
  );
}
