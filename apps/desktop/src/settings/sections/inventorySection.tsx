import type { ClickMode, InventoryConfig } from "@/config/appConfig";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { CONTAINER_STYLES } from "@/hud/inventory/styles";
import { setInventoryVisible } from "@/lib/windowControls";
import { Accordion } from "@/settings/components/accordion";
import {
  Button,
  Note,
  NumberField,
  Row,
  SectionHead,
  SectionSubhead,
  Select,
  Toggle,
  type Option
} from "@/settings/components/controls";
import { FileNameColorPicker } from "@/settings/components/fileNameColorPicker";
import { useCardState } from "@/settings/useCardState";

const CLICK_MODE_OPTIONS: Option<ClickMode>[] = [
  { value: "single", label: "单击" },
  { value: "double", label: "双击" }
];

const STYLE_OPTIONS: Option[] = CONTAINER_STYLES.map((style) => ({
  value: style.file,
  label: style.name
}));

export function InventorySection() {
  const config = useAppConfig();
  const inventory = config.inventory;
  const card = useCardState("InventoryTitle");

  const patch = (next: Partial<InventoryConfig>) => updateConfig({ inventory: next });

  return (
    <>
      <SectionHead title="物品栏设置" />
      <SectionSubhead>物品栏相关</SectionSubhead>
      <Accordion title="物品栏" open={card.open} onOpenChange={card.onChange}>
        <Row plain label="物品栏样式" description="点击选择物品栏的显示样式">
          <Select
            value={inventory.style}
            options={STYLE_OPTIONS}
            ariaLabel="物品栏样式"
            onChange={(style) => patch({ style })}
          />
        </Row>
        <Row plain label="打开动作" description="选择打开快捷栏格子的操作方式">
          <Select
            value={inventory.clickMode}
            options={CLICK_MODE_OPTIONS}
            ariaLabel="物品栏打开动作"
            onChange={(clickMode) => patch({ clickMode })}
          />
        </Row>
        <Row plain label="显示物品栏" description="在桌面显示物品栏窗口">
          <Toggle
            checked={inventory.visible}
            label="显示物品栏"
            onChange={(visible) => {
              // 窗口操作失败不影响配置写入，配置仍是唯一事实来源
              void setInventoryVisible(visible).catch(() => undefined);
            }}
          />
        </Row>
        <Row plain label="共享数据" description="开启后所有样式共用格子数据，关闭后每个样式独立存储">
          <Toggle
            checked={inventory.sharedData}
            label="共享数据"
            onChange={(sharedData) => patch({ sharedData })}
          />
        </Row>
        <Row plain label="锁定位置" description="防止物品栏窗口被意外拖动">
          <Toggle checked={inventory.locked} label="锁定位置" onChange={(locked) => patch({ locked })} />
        </Row>
        <Row plain label="记住位置" description="下次启动时恢复物品栏窗口位置">
          <Toggle
            checked={inventory.rememberPosition}
            label="记住位置"
            onChange={(rememberPosition) => patch({ rememberPosition })}
          />
        </Row>
        <Row plain label="悬浮效果" description="鼠标悬浮在格子时显示白色蒙版">
          <Toggle
            checked={inventory.hoverEffect}
            label="悬浮效果"
            onChange={(hoverEffect) => patch({ hoverEffect })}
          />
        </Row>
        <Row plain label="灰色蒙版" description="打开物品栏时显示全屏灰色遮罩">
          <Toggle
            checked={inventory.grayOverlay}
            label="灰色蒙版"
            onChange={(grayOverlay) => patch({ grayOverlay })}
          />
        </Row>
        <Row plain label="不透明度" description="调节灰色蒙版不透明度（0-100）" disabled={!inventory.grayOverlay}>
          <div className="inline-value">
            <NumberField
              value={inventory.grayOverlayOpacity}
              min={0}
              max={100}
              ariaLabel="灰色蒙版不透明度"
              disabled={!inventory.grayOverlay}
              onChange={(grayOverlayOpacity) => patch({ grayOverlayOpacity })}
            />
            <span className="inline-suffix">/100%</span>
          </div>
        </Row>
        <Row plain label="隐藏状态栏" description="打开物品栏时隐藏状态栏窗口">
          <Toggle
            checked={inventory.hideStatusBar}
            label="隐藏状态栏"
            onChange={(hideStatusBar) => patch({ hideStatusBar })}
          />
        </Row>
        <Row plain label="文件名颜色" description="选中快捷栏格子时显示的文件名颜色">
          <FileNameColorPicker
            value={inventory.fileNameColor}
            label="物品栏文件名颜色"
            onChange={(fileNameColor) => patch({ fileNameColor })}
          />
        </Row>
        <Row plain label="文本提示框" description="悬浮时显示文件详细信息">
          <Toggle
            checked={inventory.showTooltip}
            label="文本提示框"
            onChange={(showTooltip) => patch({ showTooltip })}
          />
        </Row>
        <Row plain label="文件名" description="显示文件名（不含后缀）" disabled={!inventory.showTooltip}>
          <Toggle
            checked={inventory.tooltipShowFileName}
            label="提示显示文件名"
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowFileName) => patch({ tooltipShowFileName })}
          />
        </Row>
        <Row plain label="原文件名" description="显示原文件名（含后缀）" disabled={!inventory.showTooltip}>
          <Toggle
            checked={inventory.tooltipShowOriginalName}
            label="提示显示原文件名"
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowOriginalName) => patch({ tooltipShowOriginalName })}
          />
        </Row>
        <Row plain label="文件路径" description="显示文件完整路径" disabled={!inventory.showTooltip}>
          <Toggle
            checked={inventory.tooltipShowFilePath}
            label="提示显示文件路径"
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowFilePath) => patch({ tooltipShowFilePath })}
          />
        </Row>
        <Row plain label="文件类型" description="显示文件后缀类型" disabled={!inventory.showTooltip}>
          <Toggle
            checked={inventory.tooltipShowFileType}
            label="提示显示文件类型"
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowFileType) => patch({ tooltipShowFileType })}
          />
        </Row>
        <Note>物品栏相关改动即时生效。</Note>
        <div className="action-card">
          <Button onClick={() => updateConfig({ inventory: defaultConfig().inventory })}>恢复默认设置</Button>
        </div>
      </Accordion>
    </>
  );
}
