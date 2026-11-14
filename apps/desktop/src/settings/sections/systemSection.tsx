import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LanguageCode } from "@/config/appConfig";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { Button, Card, Note, Row, SectionHead, Select, Toggle, type Option } from "@/settings/components/controls";

const LANGUAGE_OPTIONS: Option<LanguageCode>[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" }
];

export function SystemSection() {
  const config = useAppConfig();
  const [autoStartError, setAutoStartError] = useState<string | null>(null);

  const resetSystem = () => {
    const defaults = defaultConfig().system;
    updateConfig({ system: defaults });
  };

  return (
    <>
      <SectionHead title="系统设置" />
      <Row label="语言 / Language" description="选择界面显示语言">
        <Select
          value={config.system.language}
          options={LANGUAGE_OPTIONS}
          ariaLabel="界面语言"
          onChange={(language) => updateConfig({ system: { language } })}
        />
      </Row>
      {config.system.language === "en-US" ? <Note>英文界面后续版本提供。</Note> : null}
      <Row label="开机自启动" description="系统启动时自动运行 CraftSharp">
        <Toggle
          checked={config.system.autoStart}
          label="开机自启动"
          onChange={(autoStart) => {
            if (!("__TAURI_INTERNALS__" in window)) {
              updateConfig({ system: { autoStart } });
              return;
            }
            void invoke("set_autostart", { enabled: autoStart })
              .then(() => {
                setAutoStartError(null);
                updateConfig({ system: { autoStart } });
              })
              .catch(() => setAutoStartError("写入开机启动项失败，请检查系统权限"));
          }}
        />
      </Row>
      {autoStartError ? <Note tone="warning">{autoStartError}</Note> : null}
      <Row label="默认打开面板" description="程序启动时自动打开设置面板窗口">
        <Toggle
          checked={config.system.defaultOpenSettings}
          label="默认打开面板"
          onChange={(defaultOpenSettings) => updateConfig({ system: { defaultOpenSettings } })}
        />
      </Row>
      <Row label="记住窗口位置" description="下次启动时恢复设置窗口的位置">
        <Toggle
          checked={config.system.rememberWindowPosition}
          label="记住窗口位置"
          onChange={(rememberWindowPosition) => updateConfig({ system: { rememberWindowPosition } })}
        />
      </Row>
      <Row label="记住窗口大小" description="下次启动时恢复设置窗口的大小">
        <Toggle
          checked={config.system.rememberWindowSize}
          label="记住窗口大小"
          onChange={(rememberWindowSize) => updateConfig({ system: { rememberWindowSize } })}
        />
      </Row>
      <Row label="记住卡片状态" description="下次启动时恢复设置页面卡片的展开/折叠状态">
        <Toggle
          checked={config.system.rememberCardStates}
          label="记住卡片状态"
          onChange={(rememberCardStates) => updateConfig({ system: { rememberCardStates } })}
        />
      </Row>
      <Row label="记住菜单选项" description="下次启动时恢复上次选中的设置页面">
        <Toggle
          checked={config.system.rememberNavSelection}
          label="记住菜单选项"
          onChange={(rememberNavSelection) => updateConfig({ system: { rememberNavSelection } })}
        />
      </Row>
      <Card className="action-card">
        <Button onClick={resetSystem}>恢复默认设置</Button>
      </Card>
    </>
  );
}
