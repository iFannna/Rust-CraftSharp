import { updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { setStatusBarVisible } from "@/lib/windowControls";
import { Row, Toggle } from "@/settings/components/controls";

export function StatusBarCardContent() {
  const config = useAppConfig();
  const statusBar = config.statusBar;

  return (
    <>
      <Row plain label="显示状态栏" description="在桌面显示状态栏窗口">
        <Toggle
          checked={statusBar.visible}
          label="显示状态栏"
          onChange={(visible) => {
            // 窗口操作失败不影响配置写入，配置仍是唯一事实来源
            void setStatusBarVisible(visible).catch(() => undefined);
          }}
        />
      </Row>
      <Row plain label="锁定位置" description="防止快捷栏被意外拖动">
        <Toggle
          checked={statusBar.locked}
          label="锁定位置"
          onChange={(locked) => updateConfig({ statusBar: { locked } })}
        />
      </Row>
      <Row plain label="记住位置" description="下次启动时恢复状态栏窗口位置">
        <Toggle
          checked={statusBar.rememberPosition}
          label="记住位置"
          onChange={(rememberPosition) => updateConfig({ statusBar: { rememberPosition } })}
        />
      </Row>
    </>
  );
}
