import type { ClickMode, InventoryConfig } from "../../config/appConfig";
import { updateConfig } from "../../config/appConfig";
import { useAppConfig } from "../../config/useAppConfig";
import { CONTAINER_STYLES } from "../../hud/inventoryStyles";
import { setInventoryVisible } from "../../windowControls";
import {
  Card,
  Check,
  Note,
  Row,
  SectionHead,
  Select,
  SliderRow,
  Toggle,
  type Option
} from "../components/controls";
import { FileNameColorPicker } from "../components/fileNameColorPicker";

const CLICK_MODE_OPTIONS: Option<ClickMode>[] = [
  { value: "single", label: "单击" },
  { value: "double", label: "双击" }
];

const STYLE_OPTIONS: Option[] = CONTAINER_STYLES.map((style) => ({
  value: style.file,
  label: `${style.name}（${style.file}）`
}));

export function InventorySection() {
  const config = useAppConfig();
  const inventory = config.inventory;

  const patch = (next: Partial<InventoryConfig>) => updateConfig({ inventory: next });

  return (
    <>
      <SectionHead title="物品栏设置" />
      <Row label="显示物品栏" description="在桌面显示物品栏窗口">
        <Toggle
          checked={inventory.visible}
          label="显示物品栏"
          onChange={(visible) => {
            // 窗口操作失败不影响配置写入，配置仍是唯一事实来源
            void setInventoryVisible(visible).catch(() => undefined);
          }}
        />
      </Row>
      <Row label="锁定位置" description="防止物品栏被意外拖动">
        <Toggle checked={inventory.locked} label="锁定物品栏位置" onChange={(locked) => patch({ locked })} />
      </Row>
      <Row label="记住位置" description="下次打开时恢复上次的位置">
        <Toggle
          checked={inventory.rememberPosition}
          label="记住物品栏位置"
          onChange={(rememberPosition) => patch({ rememberPosition })}
        />
      </Row>
      <Row label="打开时隐藏状态栏" description="打开物品栏时同时隐藏状态栏">
        <Toggle
          checked={inventory.hideStatusBar}
          label="打开时隐藏状态栏"
          onChange={(hideStatusBar) => patch({ hideStatusBar })}
        />
      </Row>
      <Row label="容器样式" description="决定格子布局与背景图">
        <Select
          value={inventory.style}
          options={STYLE_OPTIONS}
          ariaLabel="物品栏样式"
          onChange={(style) => patch({ style })}
        />
      </Row>
      <Row label="灰色蒙版" description="打开物品栏时显示全屏灰色遮罩">
        <Toggle checked={inventory.grayOverlay} label="灰色蒙版" onChange={(grayOverlay) => patch({ grayOverlay })} />
      </Row>
      <Row label="蒙版不透明度" description="0 为全透明，100 为完全不透明" disabled={!inventory.grayOverlay}>
        <SliderRow
          value={inventory.grayOverlayOpacity}
          min={0}
          max={100}
          ariaLabel="灰色蒙版不透明度"
          disabled={!inventory.grayOverlay}
          onChange={(grayOverlayOpacity) => patch({ grayOverlayOpacity })}
        />
      </Row>
      <Row label="打开动作" description="选择打开物品栏格子的操作方式">
        <Select
          value={inventory.clickMode}
          options={CLICK_MODE_OPTIONS}
          ariaLabel="物品栏打开动作"
          onChange={(clickMode) => patch({ clickMode })}
        />
      </Row>
      <Row label="悬浮效果" description="鼠标悬停时显示白色蒙版">
        <Toggle
          checked={inventory.hoverEffect}
          label="物品栏悬浮效果"
          onChange={(hoverEffect) => patch({ hoverEffect })}
        />
      </Row>
      <Row label="共享数据" description="开启时所有样式共用同一份格子数据，关闭后按样式独立存储">
        <Toggle
          checked={inventory.sharedData}
          label="共享格子数据"
          onChange={(sharedData) => patch({ sharedData })}
        />
      </Row>
      <Row label="显示文本提示框" description="悬停格子时显示文件名信息">
        <Toggle
          checked={inventory.showTooltip}
          label="显示文本提示框"
          onChange={(showTooltip) => patch({ showTooltip })}
        />
      </Row>
      <Row label="提示内容" description="总开关关闭时所有子项都不可用">
        <div className="sub-options">
          <Check
            checked={inventory.tooltipShowFileName}
            label="显示文件名"
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowFileName) => patch({ tooltipShowFileName })}
          />
          <Check
            checked={inventory.tooltipShowOriginalName}
            label="显示原始文件名"
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowOriginalName) => patch({ tooltipShowOriginalName })}
          />
          <Check
            checked={inventory.tooltipShowFilePath}
            label="显示路径"
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowFilePath) => patch({ tooltipShowFilePath })}
          />
          <Check
            checked={inventory.tooltipShowFileType}
            label="显示文件类型"
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowFileType) => patch({ tooltipShowFileType })}
          />
        </div>
      </Row>
      <Row label="文件名颜色" description="自动模式按文件名稳定取色">
        <FileNameColorPicker
          value={inventory.fileNameColor}
          label="物品栏文件名颜色"
          onChange={(fileNameColor) => patch({ fileNameColor })}
        />
      </Row>
      <Note>物品栏相关改动即时生效。</Note>
    </>
  );
}
