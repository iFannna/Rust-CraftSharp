import type { LanguageCode } from "../../config/appConfig";
import { updateConfig } from "../../config/appConfig";
import { useAppConfig } from "../../config/useAppConfig";
import { Note, Row, SectionHead, Select, Toggle, type Option } from "../components/controls";

const LANGUAGE_OPTIONS: Option<LanguageCode>[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" }
];

export function SystemSection() {
  const config = useAppConfig();

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
        <Toggle checked={config.system.autoStart} disabled label="开机自启动" onChange={() => undefined} />
      </Row>
      <Row label="默认打开面板" description="程序启动时自动打开设置面板窗口">
        <Toggle
          checked={config.system.defaultOpenSettings}
          label="默认打开面板"
          onChange={(defaultOpenSettings) => updateConfig({ system: { defaultOpenSettings } })}
        />
      </Row>
    </>
  );
}
