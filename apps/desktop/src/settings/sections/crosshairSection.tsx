import { updateConfig } from "../../config/appConfig";
import { useAppConfig } from "../../config/useAppConfig";
import { setCrosshairVisible } from "../../windowControls";
import { Row, SectionHead, Toggle } from "../components/controls";

export function CrosshairSection() {
  const config = useAppConfig();

  return (
    <>
      <SectionHead title="准星设置" />
      <Row label="显示准星" description="在桌面显示准星窗口">
        <Toggle
          checked={config.hudElements.crosshairVisible}
          label="显示准星"
          onChange={(visible) => {
            // 窗口操作失败不影响配置写入，配置仍是唯一事实来源
            void setCrosshairVisible(visible).catch(() => undefined);
          }}
        />
      </Row>
      <Row label="攻击指示器" description="在准星下方显示攻击冷却进度">
        <Toggle
          checked={config.hudElements.attackIndicatorVisible}
          label="攻击指示器"
          onChange={(attackIndicatorVisible) => updateConfig({ hudElements: { attackIndicatorVisible } })}
        />
      </Row>
    </>
  );
}
