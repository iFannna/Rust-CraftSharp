import type { ClickMode } from "@/config/appConfig";
import { updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { Row, SectionHead, Select, Toggle, type Option } from "@/settings/components/controls";
import { FileNameColorPicker } from "@/settings/components/fileNameColorPicker";

const CLICK_MODE_OPTIONS: Option<ClickMode>[] = [
  { value: "single", label: "单击" },
  { value: "double", label: "双击" }
];

export function HotbarCardContent() {
  const config = useAppConfig();
  const hotbar = config.hotbar;

  return (
    <>
      <SectionHead title="快捷栏设置" />
      <Row plain label="文件名颜色" description="选中快捷栏格子时显示的文件名颜色">
        <FileNameColorPicker
          value={hotbar.fileNameColor}
          label="快捷栏文件名颜色"
          onChange={(fileNameColor) => updateConfig({ hotbar: { fileNameColor } })}
        />
      </Row>
      <Row plain label="打开动作" description="选择打开快捷栏格子的操作方式">
        <Select
          value={hotbar.clickMode}
          options={CLICK_MODE_OPTIONS}
          ariaLabel="快捷栏打开动作"
          onChange={(clickMode) => updateConfig({ hotbar: { clickMode } })}
        />
      </Row>
      <Row plain label="显示快捷栏" description="在桌面显示快捷栏窗口">
        <Toggle
          checked={hotbar.visible}
          label="显示快捷栏"
          onChange={(visible) => updateConfig({ hotbar: { visible } })}
        />
      </Row>
      <Row plain label="悬浮效果" description="鼠标悬停时显示选中框">
        <Toggle
          checked={hotbar.hoverEffect}
          label="快捷栏悬浮效果"
          onChange={(hoverEffect) => updateConfig({ hotbar: { hoverEffect } })}
        />
      </Row>
      <Row plain label="左副手槽" description="在快捷栏左侧显示副手槽位">
        <Toggle
          checked={hotbar.leftOffhand}
          label="左副手槽"
          onChange={(leftOffhand) => updateConfig({ hotbar: { leftOffhand } })}
        />
      </Row>
      <Row plain label="右副手槽" description="在快捷栏右侧显示副手槽位">
        <Toggle
          checked={hotbar.rightOffhand}
          label="右副手槽"
          onChange={(rightOffhand) => updateConfig({ hotbar: { rightOffhand } })}
        />
      </Row>
      <Row plain label="显示目标程序图标" description="仅对快捷方式生效，可能因为权限问题失效">
        <Toggle
          checked={hotbar.showTargetIcon}
          label="显示目标程序图标"
          onChange={(showTargetIcon) => updateConfig({ hotbar: { showTargetIcon } })}
        />
      </Row>
    </>
  );
}
