import { updateConfig, type HudElementId, type HudElementsConfig } from "@/config/appConfig";
import { elementIconUrls } from "@/hud/statusbar/iconStyles";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { openDialogWindow } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { NumberField, Row, Select, Toggle } from "@/settings/components/controls";
import { dataMappingOptions } from "@/settings/options";

export function ElementCard({ id, label }: { id: HudElementId; label: string }) {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const element = config.hudElements.elements[id];
  const urls = elementIconUrls(id, element.iconStyle);

  const patch = (next: Partial<HudElementsConfig["elements"][HudElementId]>) => {
    const hud = config.hudElements;
    updateConfig({
      hudElements: {
        ...hud,
        elements: { ...hud.elements, [id]: { ...element, ...next } }
      }
    });
  };

  const openIconPicker = async () => {
    const picked = await openDialogWindow<string>({
      label: WINDOW_LABEL.hudIconPicker,
      title: t("hudIconPicker.title"),
      page: "hud-icon-picker",
      params: { element: id, value: element.iconStyle },
      width: 480,
      height: 360,
      minWidth: 300,
      minHeight: 250,
      mode: "display",
      anchor: WINDOW_LABEL.settings
    });
    if (picked === null) return;
    patch({ iconStyle: picked });
  };

  return (
    <>
      <Row plain label={t("hud.elementIcon")} description={t("hud.elementIconDesc")}>
        <button
          type="button"
          className="grid h-9 place-items-center rounded-sm px-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("aria.elementIconStyle", { label })}
          onClick={() => void openIconPicker()}
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
        </button>
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
    </>
  );
}
