import type { ClickMode } from "../../config/appConfig";
import { updateConfig } from "../../config/appConfig";
import { useAppConfig } from "../../config/useAppConfig";
import { Card, Note, Row, SectionHead, Segmented, Toggle, type Option } from "../components/controls";
import { FileNameColorPicker } from "../components/fileNameColorPicker";

const CLICK_MODE_OPTIONS: Option<ClickMode>[] = [
  { value: "single", label: "单击打开" },
  { value: "double", label: "双击打开" }
];

export function HotbarSection() {
  const config = useAppConfig();
  const hotbar = config.hotbar;

  return (
    <>
      <SectionHead title="快捷栏" description="状态栏上的快捷栏与文件名显示。" />
      <Card>
        <Row label="显示快捷栏" description="关闭后只隐藏快捷栏与副手槽。">
          <Toggle
            checked={hotbar.visible}
            label="显示快捷栏"
            onChange={(visible) => updateConfig({ hotbar: { visible } })}
          />
        </Row>
        <Row label="左副手" description="在快捷栏左侧显示副手槽。">
          <Toggle
            checked={hotbar.leftOffhand}
            label="左副手"
            onChange={(leftOffhand) => updateConfig({ hotbar: { leftOffhand } })}
          />
        </Row>
        <Row label="右副手" description="在快捷栏右侧显示副手槽。">
          <Toggle
            checked={hotbar.rightOffhand}
            label="右副手"
            onChange={(rightOffhand) => updateConfig({ hotbar: { rightOffhand } })}
          />
        </Row>
        <Row label="点击模式" description="打开格子内容所需的点击次数。">
          <Segmented
            value={hotbar.clickMode}
            options={CLICK_MODE_OPTIONS}
            ariaLabel="快捷栏点击模式"
            onChange={(clickMode) => updateConfig({ hotbar: { clickMode } })}
          />
        </Row>
        <Row label="悬浮效果" description="鼠标悬停时显示选中框。">
          <Toggle
            checked={hotbar.hoverEffect}
            label="快捷栏悬浮效果"
            onChange={(hoverEffect) => updateConfig({ hotbar: { hoverEffect } })}
          />
        </Row>
        <Row label="显示目标图标" description="快捷方式显示其目标程序的图标。">
          <Toggle
            checked={hotbar.showTargetIcon}
            label="显示目标图标"
            onChange={(showTargetIcon) => updateConfig({ hotbar: { showTargetIcon } })}
          />
        </Row>
        <Row label="文件名颜色" description="自动模式按文件名稳定取色。">
          <FileNameColorPicker
            value={hotbar.fileNameColor}
            label="快捷栏文件名颜色"
            onChange={(fileNameColor) => updateConfig({ hotbar: { fileNameColor } })}
          />
        </Row>
      </Card>
      <Note>快捷栏相关改动即时生效。</Note>
    </>
  );
}
