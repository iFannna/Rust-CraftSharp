import type { ThemeMode, UIFont } from "@/config/appConfig";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { Button, Card, Row, SectionHead, Select, type Option } from "@/settings/components/controls";

const THEME_OPTIONS: Option<ThemeMode>[] = [
  { value: "system", label: "跟随系统" },
  { value: "dark", label: "暗色" },
  { value: "light", label: "亮色" }
];

const FONT_OPTIONS: Option<UIFont>[] = [
  { value: "yahei", label: "微软雅黑" },
  { value: "pixel", label: "像素字体" },
  { value: "unifont", label: "Unifont" },
  { value: "songti", label: "宋体" },
  { value: "kaiti", label: "楷体" },
  { value: "heiti", label: "黑体" }
];

const SIZE_OPTIONS: Option<string>[] = ["10", "12", "14", "16", "18", "20"].map((size) => ({
  value: size,
  label: size
}));

export function AppearanceSection() {
  const config = useAppConfig();

  const reset = () => {
    const defaults = defaultConfig().appearance;
    updateConfig({ appearance: defaults });
  };

  return (
    <>
      <SectionHead title="外观设置" />
      <Row label="主题" description="选择界面显示风格">
        <Select
          value={config.appearance.theme}
          options={THEME_OPTIONS}
          ariaLabel="主题"
          onChange={(theme) => updateConfig({ appearance: { ...config.appearance, theme } })}
        />
      </Row>
      <Row label="字体" description="选择界面显示字体">
        <Select
          value={config.appearance.font}
          options={FONT_OPTIONS}
          ariaLabel="界面字体"
          onChange={(font) => updateConfig({ appearance: { ...config.appearance, font } })}
        />
      </Row>
      <Row label="字体大小" description="选择界面字体大小">
        <Select
          value={String(config.appearance.fontSize)}
          options={SIZE_OPTIONS}
          ariaLabel="界面字体大小"
          onChange={(size) =>
            updateConfig({ appearance: { ...config.appearance, fontSize: Number(size) } })
          }
        />
      </Row>
      <Card className="action-card">
        <Button onClick={reset}>恢复默认设置</Button>
      </Card>
    </>
  );
}
