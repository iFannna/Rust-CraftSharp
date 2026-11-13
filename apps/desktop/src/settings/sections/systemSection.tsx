import type { LanguageCode } from "../../config/appConfig";
import { updateConfig } from "../../config/appConfig";
import { useAppConfig } from "../../config/useAppConfig";
import { Card, Note, Row, SectionHead, Select, Toggle, type Option } from "../components/controls";

const LANGUAGE_OPTIONS: Option<LanguageCode>[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" }
];

export function SystemSection() {
  const config = useAppConfig();

  return (
    <>
      <SectionHead title="系统" description="界面语言与启动行为。" />
      <Card>
        <Row label="界面语言" description="当前只有简体中文真正可用。">
          <Select
            value={config.system.language}
            options={LANGUAGE_OPTIONS}
            ariaLabel="界面语言"
            onChange={(language) => updateConfig({ system: { language } })}
          />
        </Row>
        {config.system.language === "en-US" ? <Note>英文界面后续版本提供。</Note> : null}
        <Row label="开机自启" description="登录系统时自动运行，后续版本提供。">
          <Toggle checked={config.system.autoStart} disabled label="开机自启" onChange={() => undefined} />
        </Row>
        <Row label="启动时打开设置" description="启动应用后自动弹出设置面板。">
          <Toggle
            checked={config.system.defaultOpenSettings}
            label="启动时打开设置"
            onChange={(defaultOpenSettings) => updateConfig({ system: { defaultOpenSettings } })}
          />
        </Row>
      </Card>
    </>
  );
}
