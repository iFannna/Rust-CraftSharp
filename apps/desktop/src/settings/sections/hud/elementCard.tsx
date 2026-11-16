import { updateConfig, type HudElementId, type HudElementsConfig } from "@/config/appConfig";
import { stylePreviewUrl } from "@/hud/statusbar/iconStyles";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { NumberField, Row, Select, Toggle } from "@/settings/components/controls";
import { dataMappingOptions, elementIconStyleOptions } from "@/settings/options";

export function ElementCard({ id, label }: { id: HudElementId; label: string }) {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const element = config.hudElements.elements[id];
  const styleOptions = elementIconStyleOptions(id, t);
  const preview = stylePreviewUrl(id, element.iconStyle);

  const patch = (next: Partial<HudElementsConfig["elements"][HudElementId]>) => {
    const hud = config.hudElements;
    updateConfig({
      hudElements: {
        ...hud,
        elements: { ...hud.elements, [id]: { ...element, ...next } }
      }
    });
  };

  return (
    <>
      <Row plain label={t("hud.elementIcon")} description={t("hud.elementIconDesc")}>
        <img className="element-icon" src={preview} alt="" draggable={false} />
      </Row>
      {styleOptions ? (
        <Row plain label={t("hud.iconStyle")} description={t("hud.iconStyleDesc")}>
          <Select
            value={element.iconStyle}
            options={styleOptions}
            ariaLabel={t("aria.elementIconStyle", { label })}
            onChange={(iconStyle) => patch({ iconStyle })}
          />
        </Row>
      ) : null}
      <Row plain label={t("hud.showElement")} description={t("hud.showElementDesc")}>
        <Toggle
          checked={element.visible}
          label={t("hud.showElement")}
          onChange={(visible) => patch({ visible })}
        />
      </Row>
      {id === "health" || id === "air" ? (
        <Row
          plain
          label={t("hud.animation")}
          description={t(id === "health" ? "hud.healthAnimDesc" : "hud.airAnimDesc")}
        >
          <Toggle
            checked={element.regenAnimation}
            label={t("hud.animation")}
            onChange={(regenAnimation) => patch({ regenAnimation })}
          />
        </Row>
      ) : null}
      {id === "food" ? (
        <Row plain label={t("hud.saturation")} description={t("hud.saturationDesc")}>
          <NumberField
            value={element.saturationValue}
            min={0}
            max={element.maxValue}
            ariaLabel={t("hud.saturation")}
            onChange={(saturationValue) => patch({ saturationValue })}
          />
        </Row>
      ) : null}
      <Row plain label={t("hud.dataMapping")} description={t("hud.dataMappingDesc")}>
        <Toggle
          checked={element.dataMappingEnabled}
          label={t("hud.dataMapping")}
          onChange={(dataMappingEnabled) =>
            patch({ dataMappingEnabled, customValueEnabled: dataMappingEnabled ? false : element.customValueEnabled })
          }
        />
      </Row>
      {element.dataMappingEnabled ? (
        <Row plain label={t("hud.mappingSource")} description={t("hud.mappingSourceDesc")}>
          <Select
            value={element.dataMappingType}
            options={dataMappingOptions(t)}
            ariaLabel={t("aria.elementDataMapping", { label })}
            onChange={(dataMappingType) => patch({ dataMappingType })}
          />
        </Row>
      ) : null}
      <Row plain label={t("hud.customValue")} description={t("hud.customValueDesc")}>
        <Toggle
          checked={element.customValueEnabled}
          label={t("hud.customValue")}
          onChange={(customValueEnabled) =>
            patch({ customValueEnabled, dataMappingEnabled: customValueEnabled ? false : element.dataMappingEnabled })
          }
        />
      </Row>
      {element.customValueEnabled ? (
        <Row plain label={t("hud.currentValue")} description={t("hud.elementCurrentDesc")}>
          <NumberField
            value={element.currentValue}
            min={0}
            max={id === "expBar" ? 100 : element.maxValue}
            ariaLabel={t("aria.elementCurrent", { label })}
            onChange={(currentValue) => patch({ currentValue })}
          />
        </Row>
      ) : null}
      {id === "expBar" ? null : (
        <Row plain label={t("hud.maxValue")} description={t("hud.maxValueDesc")}>
          <NumberField
            value={element.maxValue}
            min={2}
            max={1024}
            ariaLabel={t("aria.elementMax", { label })}
            onChange={(maxValue) => patch({ maxValue: Math.max(2, maxValue), currentValue: Math.min(element.currentValue, maxValue) })}
          />
        </Row>
      )}
    </>
  );
}
