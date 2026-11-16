import { updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { setCrosshairVisible } from "@/lib/windowControls";
import { NumberField, Row, Select, Toggle } from "@/settings/components/controls";
import { dataMappingOptions } from "@/settings/options";

export function CrosshairCardContent() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const hud = config.hudElements;

  return (
    <>
      <Row plain label={t("hud.showCrosshair")} description={t("hud.showCrosshairDesc")}>
        <Toggle
          checked={hud.crosshairVisible}
          label={t("hud.showCrosshair")}
          onChange={(visible) => {
            // 窗口操作失败不影响配置写入，配置仍是唯一事实来源
            void setCrosshairVisible(visible).catch(() => undefined);
          }}
        />
      </Row>
      <Row plain label={t("hud.topMost")} description={t("hud.topMostDesc")}>
        <Toggle
          checked={hud.crosshairTopMost}
          label={t("hud.topMost")}
          onChange={(crosshairTopMost) => updateConfig({ hudElements: { ...hud, crosshairTopMost } })}
        />
      </Row>
    </>
  );
}

export function AttackIndicatorCardContent() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const hud = config.hudElements;
  const indicator = hud.attackIndicator;

  const patch = (next: Partial<typeof indicator>) => {
    updateConfig({ hudElements: { ...hud, attackIndicator: { ...indicator, ...next } } });
  };

  return (
    <>
      <Row plain label={t("hud.showElement")} description={t("hud.showElementDesc")}>
        <Toggle
          checked={hud.attackIndicatorVisible}
          label={t("hud.showElement")}
          onChange={(attackIndicatorVisible) => updateConfig({ hudElements: { ...hud, attackIndicatorVisible } })}
        />
      </Row>
      <Row plain label={t("hud.dataMapping")} description={t("hud.dataMappingDesc")}>
        <Toggle
          checked={indicator.dataMappingEnabled}
          label={t("aria.attackMapping")}
          onChange={(dataMappingEnabled) =>
            patch({ dataMappingEnabled, customValueEnabled: dataMappingEnabled ? false : indicator.customValueEnabled })
          }
        />
      </Row>
      {indicator.dataMappingEnabled ? (
        <Row plain label={t("hud.mappingSource")} description={t("hud.mappingSourceDesc")}>
          <Select
            value={indicator.dataMappingType}
            options={dataMappingOptions(t)}
            ariaLabel={t("aria.attackMapping")}
            onChange={(dataMappingType) => patch({ dataMappingType })}
          />
        </Row>
      ) : null}
      <Row plain label={t("hud.customValue")} description={t("hud.attackCustomDesc")}>
        <Toggle
          checked={indicator.customValueEnabled}
          label={t("aria.enableCustom")}
          onChange={(customValueEnabled) =>
            patch({ customValueEnabled, dataMappingEnabled: customValueEnabled ? false : indicator.dataMappingEnabled })
          }
        />
      </Row>
      {indicator.customValueEnabled ? (
        <Row plain label={t("hud.currentValue")} description={t("hud.currentDesc")}>
          <NumberField
            value={indicator.currentValue}
            min={0}
            max={100}
            ariaLabel={t("aria.attackCurrent")}
            onChange={(currentValue) => patch({ currentValue })}
          />
        </Row>
      ) : null}
    </>
  );
}
