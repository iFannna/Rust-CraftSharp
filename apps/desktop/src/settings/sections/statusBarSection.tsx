import { useState } from "react";
import { updateConfig } from "../../config/appConfig";
import { useAppConfig } from "../../config/useAppConfig";
import { Button, Card, Note, Row, SectionHead, Toggle } from "../components/controls";
import { setStatusBarVisible } from "../../windowControls";

export function StatusBarSection() {
  const config = useAppConfig();
  const [message, setMessage] = useState<string | null>(null);

  const resetPosition = () => {
    updateConfig({ statusBar: { position: null } });
    setMessage("已恢复默认位置，重启状态栏后回到屏幕底部居中。");
  };

  return (
    <>
      <SectionHead title="状态栏" description="桌面底部快捷栏容器的显示与位置。" />
      <Card>
        <Row label="显示状态栏" description="切换状态栏窗口的显隐。">
          <Toggle
            checked={config.statusBar.visible}
            label="显示状态栏"
            onChange={(visible) => {
              // 窗口操作失败不影响配置写入，配置仍是唯一事实来源
              void setStatusBarVisible(visible).catch(() => undefined);
            }}
          />
        </Row>
        <Row label="锁定位置" description="锁定后不能拖动状态栏。">
          <Toggle
            checked={config.statusBar.locked}
            label="锁定状态栏位置"
            onChange={(locked) => updateConfig({ statusBar: { locked } })}
          />
        </Row>
        <div className="button-row">
          <Button onClick={resetPosition}>恢复默认位置</Button>
        </div>
      </Card>
      {message ? <Note tone="success">{message}</Note> : null}
    </>
  );
}
