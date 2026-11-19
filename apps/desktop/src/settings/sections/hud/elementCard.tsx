import { updateConfig, type HudElementId, type HudElementsConfig } from "@/config/appConfig";
import { elementIconUrls } from "@/hud/statusbar/iconStyles";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { NumberField, Row, Select, Toggle } from "@/settings/components/controls";
import { dataMappingOptions } from "@/settings/options";
import { HudIconButton } from "@/settings/sections/hud/iconPickerButton";

/** 各元素最大值上限：生命、饥饿、空气、护甲最多 20 点，伤害吸收 1024 点 */
const MAX_VALUE_LIMITS: Partial<Record<HudElementId, number>> = {
  health: 20,
  food: 20,
  air: 20,
  armor: 20,
  absorbing: 1024
};

export function ElementCard({ id, label }: { id: HudElementId; label: string }) {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const element = config.hudElements.elements[id];
  const urls = elementIconUrls(id, element.iconStyle);
  const maxLimit = MAX_VALUE_LIMITS[id] ?? 1024;

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
        <HudIconButton
          element={id}
          value={element.iconStyle}
          onPicked={(iconStyle) => patch({ iconStyle })}
        >
          {id === "expBar" ? (
            <img
              src={urls.icon}
              alt=""
              draggable={false}
              className="h-6 w-auto max-w-[240px] object-contain [image-rendering:pixelated]"
            />
          ) : (
            <span className="relative grid h-7 w-7 place-items-center">
              {urls.background ? (
                <img
                  src={urls.background}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-contain [image-rendering:pixelated]"
                />
              ) : null}
              <img
                src={urls.icon}
                alt=""
                draggable={false}
                className="relative h-full w-full object-contain [image-rendering:pixelated]"
              />
            </span>
          )}
        </HudIconButton>
      </Row>
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
          <div className="flex items-center gap-2">
            <NumberField
              value={element.currentValue}
              min={0}
              max={id === "expBar" ? 100 : element.maxValue}
              ariaLabel={t("aria.elementCurrent", { label })}
              onChange={(currentValue) => patch({ currentValue })}
            />
            <span className="text-xs text-muted-foreground">
              /{id === "expBar" ? 100 : element.maxValue}
            </span>
          </div>
        </Row>
      ) : null}
      {id === "expBar" ? null : (
        <Row plain label={t("hud.maxValue")} description={t("hud.maxValueDesc")}>
          <div className="flex items-center gap-2">
            <NumberField
              value={element.maxValue}
              min={2}
              max={maxLimit}
              ariaLabel={t("aria.elementMax", { label })}
              onChange={(maxValue) => {
                // 上限内取偶数，并把当前值和饱和度一并夹紧
                const next = Math.floor(Math.min(maxLimit, Math.max(2, maxValue)) / 2) * 2;
                patch({
                  maxValue: next,
                  currentValue: Math.min(element.currentValue, next),
                  saturationValue: Math.min(element.saturationValue, next)
                });
              }}
            />
            <span className="text-xs text-muted-foreground">/{maxLimit}</span>
          </div>
        </Row>
      )}
      {id === "food" ? (
        <Row plain label={t("hud.saturation")} description={t("hud.saturationDesc")}>
          <div className="flex items-center gap-2">
            <NumberField
              value={element.saturationValue}
              min={0}
              max={element.maxValue}
              ariaLabel={t("hud.saturation")}
              onChange={(saturationValue) => patch({ saturationValue })}
            />
            <span className="text-xs text-muted-foreground">/{element.maxValue}</span>
          </div>
        </Row>
      ) : null}
    </>
  );
}
