import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { getConfig } from "@/config/appConfig";
import { emitDialogResult } from "@/lib/dialogWindow";
import { installLocalHotkeys } from "@/lib/localHotkeys";
import { useRevealWindow } from "@/lib/windowReveal";
import { applyWindowTitle } from "@/lib/windowTitle";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { tOf } from "@/i18n";
import { appIconUrl, DEFAULT_APP_ICON } from "@/settings/appIcons";
import { APP_ICON_GROUPS } from "@/settings/appIconCatalog";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip";
import { ChevronDownIcon } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";
import "@/ui/styles.css";

const params = new URLSearchParams(location.search);

const ICON_BUTTON =
  "grid h-20 w-20 flex-none place-items-center overflow-hidden rounded-sm bg-secondary/60 transition-colors hover:bg-accent";
const ICON_SELECTED = "bg-accent ring-1 ring-inset ring-ring";

function displayName(file: string): string {
  return file.replace(/\.[^.]+$/, "");
}

function IconPicker() {
  useRevealWindow();
  const t = tOf(getConfig().system.language);
  const value = params.get("value") ?? "";
  const [active, setActive] = useState(
    () => `${APP_ICON_GROUPS[0].id}:${APP_ICON_GROUPS[0].categories[0].id}`
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(APP_ICON_GROUPS.map((group) => [group.id, true]))
  );

  const finish = (icon: string | null) => emitDialogResult(WINDOW_LABEL.iconPicker, icon);

  useEffect(() => {
    applyWindowTitle(t("iconPicker.title"));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const [groupId, categoryId] = active.split(":");
  const group = APP_ICON_GROUPS.find((item) => item.id === groupId) ?? APP_ICON_GROUPS[0];
  const category = group.categories.find((item) => item.id === categoryId) ?? group.categories[0];

  return (
    <ThemeRoot>
      <WindowFrame
        title={t("iconPicker.title")}
        resizable
        onClose={() => finish(null)}
      >
        <div className="flex min-h-0 flex-1">
          <nav
            className="ui-scroll w-[180px] flex-none overflow-y-auto border-r p-2"
            aria-label={t("iconPicker.title")}
          >
            {APP_ICON_GROUPS.map((item) => {
              const open = expanded[item.id] ?? true;
              return (
                <div key={item.id}>
                  <button
                    type="button"
                    className="flex h-8 w-full items-center gap-1 rounded px-1 text-left text-sm transition-colors hover:bg-accent"
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded((current) => ({ ...current, [item.id]: !open }))
                    }
                  >
                    <ChevronDownIcon
                      size={16}
                      className={cn(
                        "flex-none text-muted-foreground transition-transform",
                        !open && "-rotate-90"
                      )}
                    />
                    <span>{t(item.labelKey)}</span>
                  </button>
                  {open
                    ? item.categories.map((entry) => {
                        const key = `${item.id}:${entry.id}`;
                        return (
                          <button
                            key={key}
                            type="button"
                            className={cn(
                              "ml-4 flex h-8 w-[calc(100%-1rem)] items-center rounded px-2 text-left text-sm transition-colors hover:bg-accent",
                              key === active && "bg-secondary text-secondary-foreground"
                            )}
                            aria-current={key === active ? "true" : undefined}
                            onClick={() => setActive(key)}
                          >
                            {t(entry.labelKey)}
                          </button>
                        );
                      })
                    : null}
                </div>
              );
            })}
            <div className="mt-2 border-t pt-2">
              <button
                type="button"
                className={cn(
                  "flex h-8 w-full items-center rounded pl-5 pr-1 text-left text-sm transition-colors hover:bg-accent",
                  value === DEFAULT_APP_ICON && "bg-secondary text-secondary-foreground"
                )}
                aria-current={value === DEFAULT_APP_ICON ? "true" : undefined}
                onClick={() => finish(DEFAULT_APP_ICON)}
              >
                {t("iconPicker.defaultIcon")}
              </button>
            </div>
          </nav>

          <div className="ui-scroll flex-1 overflow-y-auto p-4">
            <div className="grid content-start justify-center gap-2 [grid-template-columns:repeat(auto-fill,80px)]">
              {category.entries.map((entry) => (
                <Tooltip key={entry.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(ICON_BUTTON, entry.id === value && ICON_SELECTED)}
                      aria-label={entry.file}
                      onClick={() => finish(entry.id)}
                    >
                      <img
                        src={appIconUrl(entry.id)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="h-full w-full object-cover object-top [image-rendering:pixelated]"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{displayName(entry.file)}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        </div>
      </WindowFrame>
    </ThemeRoot>
  );
}

installLocalHotkeys({ local: false });
ReactDOM.createRoot(document.getElementById("root")!).render(<IconPicker />);
