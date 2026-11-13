import { updateConfig } from "../../config/appConfig";
import { useAppConfig } from "../../config/useAppConfig";
import { setCrosshairVisible } from "../../windowControls";
import { Card, Note, Row, SectionHead, Toggle } from "../components/controls";

export function CrosshairSection() {
  const config = useAppConfig();

  return (
    <>
      <SectionHead title="准星" description="屏幕中央准星与攻击指示器。" />
      <Card>
        <Row label="显示准星" description="切换准星窗口的显隐。">
          <Toggle
            checked={config.hudElements.crosshairVisible}
            label="显示准星"
            onChange={(visible) => {
              // 窗口操作失败不影响配置写入，配置仍是唯一事实来源
              void setCrosshairVisible(visible).catch(() => undefined);
            }}
          />
        </Row>
        <Row label="攻击指示器" description="准星下方显示攻击冷却进度。">
          <Toggle
            checked={config.hudElements.attackIndicatorVisible}
            label="攻击指示器"
            onChange={(attackIndicatorVisible) => updateConfig({ hudElements: { attackIndicatorVisible } })}
          />
        </Row>
      </Card>
      <Note>准星改动即时生效。</Note>
    </>
  );
}
