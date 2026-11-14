import type { DataMappingType, HudElementId } from "@/config/appConfig";
import { iconStyleOptions, stylePreviewUrl } from "@/hud/statusbar/iconStyles";
import { updateConfig, type HudElementsConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import {
  NumberField,
  Row,
  Select,
  Toggle,
  type Option
} from "@/settings/components/controls";

const MAPPING_OPTIONS: Option<DataMappingType>[] = [
  { value: "battery", label: "电池电量" },
  { value: "memory", label: "内存占用" },
  { value: "cpu", label: "CPU 占用" },
  { value: "gpu", label: "GPU 占用" }
];

export function ElementCard({ id, label }: { id: HudElementId; label: string }) {
  const config = useAppConfig();
  const element = config.hudElements.elements[id];
  const styleOptions = iconStyleOptions(id);
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
      <Row plain label="元素图标" description="原版资源预览">
        <img className="element-icon" src={preview} alt="" draggable={false} />
      </Row>
      {styleOptions ? (
        <Row plain label="图标样式" description="切换元素使用的原版贴图">
          <Select
            value={element.iconStyle}
            options={styleOptions}
            ariaLabel={`${label}图标样式`}
            onChange={(iconStyle) => patch({ iconStyle })}
          />
        </Row>
      ) : null}
      <Row plain label="显示元素" description="在快捷栏上显示此 HUD 元素">
        <Toggle checked={element.visible} label="显示元素" onChange={(visible) => patch({ visible })} />
      </Row>
      {id === "health" || id === "air" ? (
        <Row
          plain
          label="动画效果"
          description={id === "health" ? "生命值变化时显示动画效果" : "空气值减少时显示气泡破裂动画效果"}
        >
          <Toggle
            checked={element.regenAnimation}
            label="动画效果"
            onChange={(regenAnimation) => patch({ regenAnimation })}
          />
        </Row>
      ) : null}
      {id === "food" ? (
        <Row plain label="饱和度" description="叠加在饥饿值上的饱和度">
          <NumberField
            value={element.saturationValue}
            min={0}
            max={element.maxValue}
            ariaLabel="饱和度"
            onChange={(saturationValue) => patch({ saturationValue })}
          />
        </Row>
      ) : null}
      <Row plain label="数据映射" description="开启后选择映射的系统数据">
        <Toggle
          checked={element.dataMappingEnabled}
          label="数据映射"
          onChange={(dataMappingEnabled) =>
            patch({ dataMappingEnabled, customValueEnabled: dataMappingEnabled ? false : element.customValueEnabled })
          }
        />
      </Row>
      {element.dataMappingEnabled ? (
        <Row plain label="映射来源" description="选择要映射的系统数据">
          <Select
            value={element.dataMappingType}
            options={MAPPING_OPTIONS}
            ariaLabel={`${label}数据映射`}
            onChange={(dataMappingType) => patch({ dataMappingType })}
          />
        </Row>
      ) : null}
      <Row plain label="自定义数值" description="开启后手动设置数值">
        <Toggle
          checked={element.customValueEnabled}
          label="自定义数值"
          onChange={(customValueEnabled) =>
            patch({ customValueEnabled, dataMappingEnabled: customValueEnabled ? false : element.dataMappingEnabled })
          }
        />
      </Row>
      {element.customValueEnabled ? (
        <Row plain label="当前值" description="0 到最大值之间">
          <NumberField
            value={element.currentValue}
            min={0}
            max={id === "expBar" ? 100 : element.maxValue}
            ariaLabel={`${label}当前值`}
            onChange={(currentValue) => patch({ currentValue })}
          />
        </Row>
      ) : null}
      {id === "expBar" ? null : (
        <Row plain label="最大值" description="决定格子数量">
          <NumberField
            value={element.maxValue}
            min={2}
            max={1024}
            ariaLabel={`${label}最大值`}
            onChange={(maxValue) => patch({ maxValue: Math.max(2, maxValue), currentValue: Math.min(element.currentValue, maxValue) })}
          />
        </Row>
      )}
    </>
  );
}
