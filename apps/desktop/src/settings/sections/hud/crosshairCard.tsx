import { getConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { ATTACK_INDICATOR_ICON, CROSSHAIR_ICON } from "@/hud/statusbar/crosshairAssets";
import { tOf } from "@/i18n";
import { openDialogWindow } from "@/lib/dialogWindow";
import { setCrosshairVisible } from "@/lib/windowControls";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { NumberField, Row, Select, Toggle } from "@/settings/components/controls";
import { HudIconButton } from "@/settings/sections/hud/iconPickerButton";
import { dataMappingOptions } from "@/settings/options";

export function CrosshairCardContent() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const hud = config.hudElements;

  const setTopMost = (crosshairTopMost: boolean) => {
    const latest = getConfig().hudElements;
    updateConfig({ hudElements: { ...latest, crosshairTopMost } });
  };

  const toggleTopMost = async (checked: boolean) => {
    if (!checked) {
      setTopMost(false);
      return;
    }
    const confirmed = await openDialogWindow<boolean>({
      label: WINDOW_LABEL.confirm,
      title: t("hud.topMostConfirmTitle"),
      page: "confirm",
      params: { kind: "confirm", text: t("hud.topMostConfirmText") },
      width: 460,
      height: 320,
      anchor: WINDOW_LABEL.settings
    });
    if (confirmed === true) setTopMost(true);
  };

  return (
    <>
      <Row plain label={t("hud.elementIcon")} description={t("hud.elementIconDesc")}>
        <HudIconButton element="crosshair" value="">
          <img
            src={CROSSHAIR_ICON}
            alt=""
            draggable={false}
            className="h-6 w-6 object-contain [image-rendering:pixelated]"
          />
        </HudIconButton>
      </Row>
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
          onChange={(crosshairTopMost) => void toggleTopMost(crosshairTopMost)}
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
      <Row plain label={t("hud.elementIcon")} description={t("hud.elementIconDesc")}>
        <HudIconButton element="attackIndicator" value="">
          <img
            src={ATTACK_INDICATOR_ICON}
            alt=""
            draggable={false}
            className="h-6 w-6 object-contain [image-rendering:pixelated]"
          />
        </HudIconButton>
      </Row>
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
          <div className="flex items-center gap-2">
            <NumberField
              value={indicator.currentValue}
              min={0}
              max={100}
              ariaLabel={t("aria.attackCurrent")}
              onChange={(currentValue) => patch({ currentValue })}
            />
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
        </Row>
      ) : null}
    </>
  );
}
