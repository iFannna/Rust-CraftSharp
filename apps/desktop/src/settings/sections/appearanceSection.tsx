import type { ThemeMode } from "../../config/appConfig";
import { updateConfig } from "../../config/appConfig";
import { useAppConfig } from "../../config/useAppConfig";
import { Card, Note, SectionHead } from "../components/controls";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" }
];

export function AppearanceSection() {
  const config = useAppConfig();

  return (
    <>
      <SectionHead title="外观" description="设置面板的主题风格。" />
      <Card>
        <div className="row">
          <div className="row-text">
            <div className="row-label">主题</div>
            <div className="row-desc">选择深色、浅色或跟随系统配色。</div>
          </div>
          <div className="row-control">
            <div className="radio-cards" role="radiogroup" aria-label="主题">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={config.appearance.theme === option.value}
                  className={config.appearance.theme === option.value ? "radio-card is-active" : "radio-card"}
                  onClick={() => updateConfig({ appearance: { theme: option.value } })}
                >
                  <span className="radio-dot" aria-hidden="true" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <Note>主题即时作用于设置面板，其余窗口随后统一跟随。</Note>
    </>
  );
}
