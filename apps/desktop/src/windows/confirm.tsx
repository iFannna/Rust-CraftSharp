import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { CircleHelp, TriangleAlert } from "lucide-react";
import { getConfig } from "@/config/appConfig";
import { emitDialogResult } from "@/lib/dialogWindow";
import { tOf } from "@/i18n";
import { Button } from "@/ui/components/button";
import { ThemeRoot } from "@/ui/theme-root";
import "@/ui/styles.css";

const LABEL = "confirm-dialog";
const params = new URLSearchParams(location.search);

function ConfirmDialog() {
  const t = tOf(getConfig().system.language);
  const kind = params.get("kind") === "alert" ? "alert" : "confirm";
  const text = params.get("text") ?? "";
  const finish = (value: boolean) => emitDialogResult(LABEL, value);

  useEffect(() => {
    document.title = t(kind === "confirm" ? "dialog.confirmTitle" : "dialog.alertTitle");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const Icon = kind === "confirm" ? CircleHelp : TriangleAlert;

  return (
    <ThemeRoot>
      <div className="flex h-screen items-center justify-center p-3">
        <div className="flex w-full flex-col gap-4 rounded-lg border bg-card p-4 shadow-md">
          <div className="flex gap-3">
            <Icon className="mt-0.5 h-5 w-5 flex-none text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="text-sm font-semibold">
                {t(kind === "confirm" ? "dialog.confirmTitle" : "dialog.alertTitle")}
              </div>
              <p className="ui-scroll max-h-[104px] overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {text}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {kind === "confirm" ? (
              <Button autoFocus type="button" variant="outline" onClick={() => finish(false)}>
                {t("common.cancel")}
              </Button>
            ) : null}
            <Button
              autoFocus={kind === "alert"}
              type="button"
              variant={kind === "confirm" ? "destructive" : "default"}
              onClick={() => finish(true)}
            >
              {t(kind === "confirm" ? "common.confirm" : "common.ok")}
            </Button>
          </div>
        </div>
      </div>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<ConfirmDialog />);
