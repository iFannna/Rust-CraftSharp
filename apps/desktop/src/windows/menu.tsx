import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MenuItemSpec } from "@/hud/slots/menu";
import { isTauri } from "@/lib/runtime";
import { ThemeRoot } from "@/ui/theme-root";
import { cn } from "@/ui/lib/utils";
import "@/ui/styles.css";

const params = new URLSearchParams(location.search);
const items: MenuItemSpec[] = JSON.parse(params.get("items") ?? "[]");

function close() {
  if (!isTauri()) return;
  void getCurrentWindow().close().catch(() => undefined);
}

function SlotMenu() {
  useEffect(() => {
    const currentWindow = isTauri() ? getCurrentWindow() : null;
    void currentWindow?.setFocus().catch(() => undefined);

    const dispose = currentWindow?.onFocusChanged(({ payload }) => {
      if (!payload) close();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      void dispose?.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  return (
    <ThemeRoot>
      <div className="flex h-screen flex-col rounded-lg border bg-popover p-1 text-popover-foreground">
        {items.map((item) =>
          item.separator ? (
            <div key={item.id} className="my-1 h-px bg-border" />
          ) : (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              className={cn(
                "flex h-8 w-full flex-none cursor-default items-center rounded-sm px-3 text-left text-sm transition-colors",
                !item.disabled && "hover:bg-accent hover:text-accent-foreground",
                item.disabled && "opacity-50"
              )}
              onClick={() => {
                if (isTauri()) void emit("menu:select", item.id);
              }}
            >
              {item.label}
            </button>
          )
        )}
      </div>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<SlotMenu />);
