import type { ThemeMode } from "../../config/appConfig";
import { updateConfig } from "../../config/appConfig";
import { useAppConfig } from "../../config/useAppConfig";
import { Row, SectionHead, Select, type Option } from "../components/controls";

const THEME_OPTIONS: Option<ThemeMode>[] = [
  { value: "system", label: "跟随系统" },
  { value: "dark", label: "暗色" },
  { value: "light", label: "亮色" }
];

export function AppearanceSection() {
  const config = useAppConfig();

  return (
    <>
      <SectionHead title="外观设置" />
      <Row label="主题" description="选择界面显示风格">
        <Select
          value={config.appearance.theme}
          options={THEME_OPTIONS}
          ariaLabel="主题"
          onChange={(theme) => updateConfig({ appearance: { theme } })}
        />
      </Row>
    </>
  );
}
