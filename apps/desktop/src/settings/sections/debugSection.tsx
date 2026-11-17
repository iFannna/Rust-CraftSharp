import { useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { reloadConfig } from "@/config/appConfig";
import { openDialogWindow } from "@/lib/dialogWindow";
import { isTauri } from "@/lib/runtime";
import { toggleEntityPreview } from "@/lib/windowControls";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { Button, Note, Row, SectionHead } from "@/settings/components/controls";

export function DebugSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const previewRef = useRef<HTMLSpanElement>(null);
  const [actionWidth, setActionWidth] = useState<number | undefined>(undefined);

  // 以打开 3D 预览按钮的实际宽度作为本页操作按钮的统一宽度
  useLayoutEffect(() => {
    const width = previewRef.current?.offsetWidth ?? 0;
    setActionWidth(width > 0 ? width : undefined);
  }, [config.system.language]);

  const clearData = async () => {
    const confirmed = await openDialogWindow<boolean>({
      label: WINDOW_LABEL.confirm,
      title: t("dialog.alertTitle"),
      page: "confirm",
      params: {
        kind: "confirm",
        text: t("debug.clearDataConfirmText")
      },
      width: 440,
      height: 220,
      anchor: WINDOW_LABEL.settings
    });
    if (confirmed !== true) return;

    setClearError(null);

    if (!isTauri()) {
      localStorage.clear();
      sessionStorage.clear();
      location.reload();
      return;
    }

    setClearing(true);
    try {
      let warning: string | null = null;
      try {
        await invoke("clear_app_data");
      } catch (reason) {
        warning = String(reason);
      }

      if (warning) {
        await openDialogWindow<boolean>({
          label: WINDOW_LABEL.confirm,
          title: t("dialog.alertTitle"),
          page: "confirm",
          params: {
            kind: "alert",
            text: t("debug.clearDataPartial", { list: warning })
          },
          width: 440,
          height: 240,
          anchor: WINDOW_LABEL.settings
        });
      }

      localStorage.clear();
      sessionStorage.clear();
      reloadConfig();
      await invoke("reload_app_windows");
    } catch (reason) {
      setClearError(String(reason));
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <SectionHead title={t("debug.title")} />
      <Row label={t("debug.previewLabel")} description={t("debug.previewDesc")}>
        <span ref={previewRef} className="inline-flex">
          <Button onClick={() => void toggleEntityPreview()}>{t("debug.openPreview")}</Button>
        </span>
      </Row>
      <Row label={t("debug.clearDataLabel")} description={t("debug.clearDataDesc")}>
        <span className="inline-flex" style={actionWidth ? { width: actionWidth } : undefined}>
          <Button className="w-full" disabled={clearing} onClick={() => void clearData()}>
            {t("debug.clearDataAction")}
          </Button>
        </span>
      </Row>
      {clearError ? <Note tone="warning">{t("debug.clearDataFailed", { reason: clearError })}</Note> : null}
    </>
  );
}
