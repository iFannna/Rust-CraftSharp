import { useState } from "react";
import { getConfig, resetConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf, type MessageKey } from "@/i18n";
import { ActionBar, Button, Card, Note, SectionHead } from "@/settings/components/controls";
import { applyAppIcon } from "@/settings/appIcons";

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
    void applyAppIcon(getConfig().appearance.appIcon);
    setConfirming(false);
    setResetting(true);
  };

  return (
    <>
      <SectionHead title={t("about.title")} />
      <Card className="mb-2 p-6">
        <div className="text-2xl font-bold tracking-tight">Craft#</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {t("about.version", { version: VERSION })}
        </div>
        <p className="my-6 text-sm leading-relaxed text-muted-foreground">{t("about.desc")}</p>
        <div className="h-px bg-border" />
        <div className="my-5 flex flex-col gap-3.5">
          {ABOUT_ROWS.map((row) => (
            <div key={row.labelKey} className="flex justify-between gap-6 text-sm">
              <span className="text-muted-foreground">{t(row.labelKey)}</span>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
        <div className="h-px bg-border" />
        <p className="mt-5 text-xs text-muted-foreground">Tauri 2 · Rust · React 19 · TypeScript · Vite 6</p>
      </Card>
      <ActionBar>
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
      </ActionBar>
      {confirming ? <Note tone="warning">{t("about.resetWarning")}</Note> : null}
      {resetting ? <Note tone="success">{t("about.resetMessage")}</Note> : null}
    </>
  );
}
