import {
  updateConfig,
  type BossBarColor,
  type BossBarConfig,
  type BossBarNotch,
  type DataMappingType
} from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import {
  Button,
  Card,
  Check,
  Note,
  NumberField,
  Select,
  TextField,
  Toggle,
  type Option
} from "@/settings/components/controls";

const COLOR_OPTIONS: Option<BossBarColor>[] = [
  { value: "blue", label: "蓝色" },
  { value: "green", label: "绿色" },
  { value: "pink", label: "粉色" },
  { value: "purple", label: "紫色" },
  { value: "red", label: "红色" },
  { value: "white", label: "白色" },
  { value: "yellow", label: "黄色" }
];

const NOTCH_OPTIONS: Option<BossBarNotch | "">[] = [
  { value: "", label: "无分段" },
  { value: "notched_6", label: "6 段" },
  { value: "notched_10", label: "10 段" },
  { value: "notched_12", label: "12 段" },
  { value: "notched_20", label: "20 段" }
];

const MAPPING_OPTIONS: Option<DataMappingType>[] = [
  { value: "battery", label: "电池电量" },
  { value: "memory", label: "内存占用" },
  { value: "cpu", label: "CPU 占用" },
  { value: "gpu", label: "GPU 占用" }
];

function newBossBar(): BossBarConfig {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Date.now().toString(36);
  return {
    id: `boss_${suffix}`,
    name: "BOSS",
    color: "blue",
    notch: null,
    enabled: true,
    dataMappingEnabled: false,
    dataMappingType: "battery",
    customValueEnabled: true,
    currentValue: 100
  };
}

export function BossBarCardContent() {
  const config = useAppConfig();
  const bars = config.bossBars;

  const patch = (id: string, next: Partial<BossBarConfig>) => {
    updateConfig({ bossBars: bars.map((bar) => (bar.id === id ? { ...bar, ...next } : bar)) });
  };

  return (
    <>
      {bars.length === 0 ? <Note>还没有 BOSS 血条，点下方按钮添加。</Note> : null}

      {bars.map((bar) => (
        <Card key={bar.id} className="bossbar-card">
          <div className="bossbar-header">
            <span className="bossbar-title">{bar.name.trim() || "未命名"}</span>
            <div className="bossbar-actions">
              <Check label="启用" checked={bar.enabled} onChange={(enabled) => patch(bar.id, { enabled })} />
              <Button
                variant="danger"
                onClick={() => updateConfig({ bossBars: bars.filter((item) => item.id !== bar.id) })}
              >
                删除
              </Button>
            </div>
          </div>

          <div className="bossbar-form">
            <label className="field">
              <span className="field-label">名称</span>
              <TextField
                value={bar.name}
                ariaLabel="BOSS 名称"
                placeholder="显示在血条上方"
                onChange={(name) => patch(bar.id, { name })}
              />
            </label>

            <div className="field">
              <span className="field-label">颜色</span>
              <Select
                value={bar.color}
                options={COLOR_OPTIONS}
                ariaLabel="BOSS 血条颜色"
                onChange={(color) => patch(bar.id, { color })}
              />
            </div>

            <div className="field">
              <span className="field-label">分段</span>
              <Select
                value={bar.notch ?? ""}
                options={NOTCH_OPTIONS}
                ariaLabel="BOSS 血条分段"
                onChange={(notch) => patch(bar.id, { notch: notch === "" ? null : (notch as BossBarConfig["notch"]) })}
              />
            </div>

            <div className="field">
              <span className="field-label">数据映射</span>
              <div className="field-inline">
                <Toggle
                  checked={bar.dataMappingEnabled}
                  label="启用数据映射"
                  onChange={(dataMappingEnabled) => patch(bar.id, { dataMappingEnabled })}
                />
                <Select
                  value={bar.dataMappingType}
                  options={MAPPING_OPTIONS}
                  disabled={!bar.dataMappingEnabled}
                  ariaLabel="数据映射类型"
                  onChange={(dataMappingType) => patch(bar.id, { dataMappingType })}
                />
              </div>
            </div>

            <div className="field">
              <span className="field-label">自定义数值</span>
              <div className="field-inline">
                <Toggle
                  checked={bar.customValueEnabled}
                  label="启用自定义数值"
                  onChange={(customValueEnabled) => patch(bar.id, { customValueEnabled })}
                />
                <NumberField
                  value={bar.currentValue}
                  min={0}
                  max={100}
                  ariaLabel="自定义数值"
                  disabled={!bar.customValueEnabled}
                  onChange={(currentValue) => patch(bar.id, { currentValue })}
                />
              </div>
            </div>
          </div>
        </Card>
      ))}

      <Card className="action-card">
        <Button primary onClick={() => updateConfig({ bossBars: [...bars, newBossBar()] })}>
          添加 BOSS 血条
        </Button>
      </Card>
    </>
  );
}
