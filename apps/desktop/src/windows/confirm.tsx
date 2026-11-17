import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { HelpIcon, WarningIcon } from "@/ui/icons";
import { getConfig } from "@/config/appConfig";
import { emitDialogResult } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { tOf } from "@/i18n";
import { Button } from "@/ui/components/button";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import "@/ui/styles.css";

const params = new URLSearchParams(location.search);

function ConfirmDialog() {
  const t = tOf(getConfig().system.language);
  const kind = params.get("kind") === "alert" ? "alert" : "confirm";
  const text = params.get("text") ?? "";
  const title = params.get("title") ?? t(kind === "confirm" ? "dialog.confirmTitle" : "dialog.alertTitle");
  const confirmLabel = params.get("confirmLabel") ?? t(kind === "confirm" ? "common.confirm" : "common.ok");
  // alert 默认只有确定键，传入 cancelLabel 时显示自定义取消键
  const cancelLabel = params.get("cancelLabel") ?? (kind === "confirm" ? t("common.cancel") : null);
  const finish = (value: boolean) => emitDialogResult(WINDOW_LABEL.confirm, value);

  useEffect(() => {
    document.title = title;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const Icon = kind === "confirm" ? HelpIcon : WarningIcon;

  return (
    <ThemeRoot>
      <WindowFrame title={title} controls="close" onClose={() => finish(false)}>
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
          <div className="flex min-h-0 flex-1 gap-3">
            <Icon className="mt-0.5 h-5 w-5 flex-none text-muted-foreground" />
            <p className="ui-scroll-auto min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {text}
            </p>
          </div>
          <div className="flex flex-none justify-end gap-2">
            {cancelLabel ? (
              <Button autoFocus={kind === "confirm"} type="button" variant="outline" onClick={() => finish(false)}>
                {cancelLabel}
              </Button>
            ) : null}
            <Button
              autoFocus={kind === "alert"}
              type="button"
              variant={kind === "confirm" ? "destructive" : "default"}
              onClick={() => finish(true)}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </WindowFrame>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<ConfirmDialog />);
