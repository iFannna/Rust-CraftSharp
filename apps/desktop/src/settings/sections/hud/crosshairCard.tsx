import { updateConfig, type DataMappingType } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { setCrosshairVisible } from "@/lib/windowControls";
import { NumberField, Row, Select, Toggle, type Option } from "@/settings/components/controls";

const MAPPING_OPTIONS: Option<DataMappingType>[] = [
  { value: "battery", label: "电池电量" },
  { value: "memory", label: "内存占用" },
  { value: "cpu", label: "CPU 占用" },
  { value: "gpu", label: "GPU 占用" }
];

export function CrosshairCardContent() {
  const config = useAppConfig();
  const hud = config.hudElements;

  return (
    <>
      <Row plain label="显示准星" description="在桌面显示准星窗口">
        <Toggle
          checked={hud.crosshairVisible}
          label="显示准星"
          onChange={(visible) => {
            // 窗口操作失败不影响配置写入，配置仍是唯一事实来源
            void setCrosshairVisible(visible).catch(() => undefined);
          }}
        />
      </Row>
      <Row plain label="窗口置顶" description="准星窗口始终保持在其他窗口之上">
        <Toggle
          checked={hud.crosshairTopMost}
          label="窗口置顶"
          onChange={(crosshairTopMost) => updateConfig({ hudElements: { ...hud, crosshairTopMost } })}
        />
      </Row>
    </>
  );
}

export function AttackIndicatorCardContent() {
  const config = useAppConfig();
  const hud = config.hudElements;
  const indicator = hud.attackIndicator;

  const patch = (next: Partial<typeof indicator>) => {
    updateConfig({ hudElements: { ...hud, attackIndicator: { ...indicator, ...next } } });
  };

  return (
    <>
      <Row plain label="显示元素" description="在快捷栏上显示此 HUD 元素">
        <Toggle
          checked={hud.attackIndicatorVisible}
          label="显示元素"
          onChange={(attackIndicatorVisible) => updateConfig({ hudElements: { ...hud, attackIndicatorVisible } })}
        />
      </Row>
      <Row plain label="数据映射" description="开启后选择映射的系统数据">
        <Toggle
          checked={indicator.dataMappingEnabled}
          label="攻击指示器数据映射"
          onChange={(dataMappingEnabled) =>
            patch({ dataMappingEnabled, customValueEnabled: dataMappingEnabled ? false : indicator.customValueEnabled })
          }
        />
      </Row>
      {indicator.dataMappingEnabled ? (
        <Row plain label="映射来源" description="选择要映射的系统数据">
          <Select
            value={indicator.dataMappingType}
            options={MAPPING_OPTIONS}
            ariaLabel="攻击指示器数据映射"
            onChange={(dataMappingType) => patch({ dataMappingType })}
          />
        </Row>
      ) : null}
      <Row plain label="自定义数值" description="0 到 100 的进度百分比">
        <Toggle
          checked={indicator.customValueEnabled}
          label="攻击指示器自定义数值"
          onChange={(customValueEnabled) =>
            patch({ customValueEnabled, dataMappingEnabled: customValueEnabled ? false : indicator.dataMappingEnabled })
          }
        />
      </Row>
      {indicator.customValueEnabled ? (
        <Row plain label="当前值" description="进度百分比">
          <NumberField
            value={indicator.currentValue}
            min={0}
            max={100}
            ariaLabel="攻击指示器当前值"
            onChange={(currentValue) => patch({ currentValue })}
          />
        </Row>
      ) : null}
    </>
  );
}
