import { updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { Row, SectionHead, Select, Toggle } from "@/settings/components/controls";
import { FileNameColorPicker } from "@/settings/components/fileNameColorPicker";
import { clickModeOptions } from "@/settings/options";

export function HotbarCardContent() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const hotbar = config.hotbar;

  return (
    <>
      <SectionHead title={t("hud.hotbarSettings")} />
      <Row plain label={t("hud.fileNameColor")} description={t("hud.fileNameColorDesc")}>
        <FileNameColorPicker
          value={hotbar.fileNameColor}
          label={t("aria.hotbarFileNameColor")}
          onChange={(fileNameColor) => updateConfig({ hotbar: { fileNameColor } })}
        />
      </Row>
      <Row plain label={t("hud.openAction")} description={t("hud.openActionDesc")}>
        <Select
          value={hotbar.clickMode}
          options={clickModeOptions(t)}
          ariaLabel={t("aria.hotbarAction")}
          onChange={(clickMode) => updateConfig({ hotbar: { clickMode } })}
        />
      </Row>
      <Row plain label={t("hud.showHotbar")} description={t("hud.showHotbarDesc")}>
        <Toggle
          checked={hotbar.visible}
          label={t("hud.showHotbar")}
          onChange={(visible) => updateConfig({ hotbar: { visible } })}
        />
      </Row>
      <Row plain label={t("hud.hoverEffect")} description={t("hud.hoverEffectDesc")}>
        <Toggle
          checked={hotbar.hoverEffect}
          label={t("hud.hoverEffect")}
          onChange={(hoverEffect) => updateConfig({ hotbar: { hoverEffect } })}
        />
      </Row>
      <Row plain label={t("hud.leftOffhand")} description={t("hud.leftOffhandDesc")}>
        <Toggle
          checked={hotbar.leftOffhand}
          label={t("hud.leftOffhand")}
          onChange={(leftOffhand) => updateConfig({ hotbar: { leftOffhand } })}
        />
      </Row>
      <Row plain label={t("hud.rightOffhand")} description={t("hud.rightOffhandDesc")}>
        <Toggle
          checked={hotbar.rightOffhand}
          label={t("hud.rightOffhand")}
          onChange={(rightOffhand) => updateConfig({ hotbar: { rightOffhand } })}
        />
      </Row>
      <Row plain label={t("hud.showTargetIcon")} description={t("hud.showTargetIconDesc")}>
        <Toggle
          checked={hotbar.showTargetIcon}
          label={t("hud.showTargetIcon")}
          onChange={(showTargetIcon) => updateConfig({ hotbar: { showTargetIcon } })}
        />
      </Row>
    </>
  );
}
