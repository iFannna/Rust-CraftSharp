import { updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { PLAYER_SKINS } from "@/entity3d/catalog";
import { tOf } from "@/i18n";
import { toggleEntityPreview } from "@/lib/windowControls";
import { Button, Row, SectionHead, Select, type Option } from "@/settings/components/controls";
import { skinTypeOptions } from "@/settings/options";

const SKIN_OPTIONS: Option<string>[] = PLAYER_SKINS.map((skin) => ({ value: skin, label: skin }));

export function DebugSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);

  return (
    <>
      <SectionHead title={t("debug.title")} />
      <Row label={t("debug.skinLabel")} description={t("debug.skinDesc")}>
        <Select
          value={config.player.skinName}
          options={SKIN_OPTIONS}
          ariaLabel={t("aria.skin")}
          onChange={(skinName) => updateConfig({ player: { ...config.player, skinName, skinPath: "" } })}
        />
      </Row>
      <Row label={t("debug.skinTypeLabel")} description={t("debug.skinTypeDesc")}>
        <Select
          value={config.player.skinType}
          options={skinTypeOptions(t)}
          ariaLabel={t("aria.skinType")}
          onChange={(skinType) => updateConfig({ player: { ...config.player, skinType } })}
        />
      </Row>
      <Row
        label={t("debug.customSkinLabel")}
        description={config.player.skinPath || t("debug.customSkinDesc")}
      >
        <Button onClick={() => void toggleEntityPreview()}>{t("debug.openPreview")}</Button>
      </Row>
    </>
  );
}
