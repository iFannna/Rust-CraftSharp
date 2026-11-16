import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig } from "@/config/appConfig";
import { emitDialogResult } from "@/lib/dialogWindow";
import { isTauri } from "@/lib/runtime";
import { tOf } from "@/i18n";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { ThemeRoot } from "@/ui/theme-root";
import "@/ui/styles.css";

const LABEL = "rename-dialog";
const params = new URLSearchParams(location.search);

function RenameDialog() {
  const t = tOf(getConfig().system.language);
  const [value, setValue] = useState(() => params.get("name") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => emitDialogResult(LABEL, value);
  const cancel = () => emitDialogResult(LABEL, null);

  useEffect(() => {
    document.title = t("rename.title");
    inputRef.current?.focus();
    inputRef.current?.select();

    let focused = false;
    const currentWindow = isTauri() ? getCurrentWindow() : null;
    const dispose = currentWindow?.onFocusChanged(({ payload }) => {
      if (payload) focused = true;
      else if (focused) cancel();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      void dispose?.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  return (
    <ThemeRoot>
      <div className="flex h-screen items-center justify-center p-3">
        <form
          className="flex w-full flex-col gap-3 rounded-lg border bg-card p-4 shadow-md"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="text-sm font-medium">{t("rename.title")}</div>
          <Input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="h-9 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.confirm")}</Button>
          </div>
        </form>
      </div>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<RenameDialog />);
