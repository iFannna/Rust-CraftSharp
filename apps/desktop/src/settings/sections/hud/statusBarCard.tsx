import { updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { setStatusBarVisible } from "@/lib/windowControls";
import { Row, Toggle } from "@/settings/components/controls";

export function StatusBarCardContent() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const statusBar = config.statusBar;

  return (
    <>
      <Row plain label={t("hud.showStatusBar")} description={t("hud.showStatusBarDesc")}>
        <Toggle
          checked={statusBar.visible}
          label={t("hud.showStatusBar")}
          onChange={(visible) => {
            // 窗口操作失败不影响配置写入，配置仍是唯一事实来源
            void setStatusBarVisible(visible).catch(() => undefined);
          }}
        />
      </Row>
      <Row plain label={t("hud.lockPosition")} description={t("hud.lockPositionDesc")}>
        <Toggle
          checked={statusBar.locked}
          label={t("hud.lockPosition")}
          onChange={(locked) => updateConfig({ statusBar: { locked } })}
        />
      </Row>
      <Row plain label={t("hud.rememberPosition")} description={t("hud.rememberPositionDesc")}>
        <Toggle
          checked={statusBar.rememberPosition}
          label={t("hud.rememberPosition")}
          onChange={(rememberPosition) => updateConfig({ statusBar: { rememberPosition } })}
        />
      </Row>
    </>
  );
}
