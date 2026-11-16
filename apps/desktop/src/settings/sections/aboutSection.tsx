import { useState } from "react";
import { resetConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf, type MessageKey } from "@/i18n";
import { Button, Card, Note, SectionHead } from "@/settings/components/controls";

const ABOUT_ROWS: { labelKey: MessageKey; value: string }[] = [
  { labelKey: "about.author", value: "iFannna" },
  { labelKey: "about.license", value: "MIT License" },
  { labelKey: "about.projectUrl", value: "GitHub" },
  { labelKey: "about.copyright", value: "© 2025 iFannna" }
];

const VERSION = "0.1.0";

export function AboutSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = () => {
    resetConfig();
    setConfirming(false);
    setResetting(true);
  };

  return (
    <>
      <SectionHead title={t("about.title")} />
      <Card className="about-card">
        <div className="about-product">Craft#</div>
        <div className="about-version">{t("about.version", { version: VERSION })}</div>
        <p className="about-desc">{t("about.desc")}</p>
        <div className="about-divider" />
        <div className="about-info">
          {ABOUT_ROWS.map((row) => (
            <div key={row.labelKey} className="about-info-row">
              <span className="about-info-label">{t(row.labelKey)}</span>
              <span className="about-info-value">{row.value}</span>
            </div>
          ))}
        </div>
        <div className="about-divider" />
        <p className="about-meta">Tauri 2 · Rust · React 19 · TypeScript · Vite 6</p>
      </Card>
      <Card className="action-card">
        {confirming ? (
          <>
            <Button onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
            <Button variant="danger" primary onClick={handleReset}>
              {t("about.confirmReset")}
            </Button>
          </>
        ) : (
          <Button onClick={() => setConfirming(true)}>{t("common.restoreDefaults")}</Button>
        )}
      </Card>
      {confirming ? <Note tone="warning">{t("about.resetWarning")}</Note> : null}
      {resetting ? <Note tone="success">{t("about.resetMessage")}</Note> : null}
    </>
  );
}
