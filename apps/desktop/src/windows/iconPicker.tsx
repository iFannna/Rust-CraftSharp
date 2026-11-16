import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { getConfig } from "@/config/appConfig";
import { emitDialogResult } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { tOf } from "@/i18n";
import { APP_ICON_GROUPS, DEFAULT_APP_ICON, DEFAULT_APP_ICON_URL, appIconUrl } from "@/settings/appIcons";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import { cn } from "@/ui/lib/utils";
import "@/ui/styles.css";

const params = new URLSearchParams(location.search);

function IconPicker() {
  const t = tOf(getConfig().system.language);
  const value = params.get("value") ?? "";
  const [active, setActive] = useState(
    () => `${APP_ICON_GROUPS[0].id}:${APP_ICON_GROUPS[0].categories[0].id}`
  );

  const finish = (icon: string | null) => emitDialogResult(WINDOW_LABEL.iconPicker, icon);

  useEffect(() => {
    document.title = t("iconPicker.title");
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
          <nav className="ui-scroll w-48 flex-none overflow-y-auto border-r p-2" aria-label={t("iconPicker.title")}>
            {APP_ICON_GROUPS.map((item) => (
              <div key={item.id}>
                <div className="px-3 pb-1.5 pt-3 text-xs font-medium text-muted-foreground">
                  {t(item.labelKey)}
                </div>
                {item.categories.map((entry) => {
                  const key = `${item.id}:${entry.id}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        "flex h-9 w-full items-center rounded-md px-3 text-left text-sm transition-colors hover:bg-accent",
                        key === active && "bg-secondary text-secondary-foreground"
                      )}
                      aria-current={key === active ? "true" : undefined}
                      onClick={() => setActive(key)}
                    >
                      {t(entry.labelKey)}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="ui-scroll grid flex-1 content-start justify-start gap-1 overflow-y-auto p-3 [grid-template-columns:repeat(auto-fill,44px)]">
            <button
              type="button"
              className={cn(
                "grid h-11 w-11 place-items-center rounded-md border border-transparent transition-colors hover:bg-accent",
                value === DEFAULT_APP_ICON && "border-ring bg-accent"
              )}
              title={t("iconPicker.defaultIcon")}
              aria-label={t("iconPicker.defaultIcon")}
              onClick={() => finish(DEFAULT_APP_ICON)}
            >
              <img
                src={DEFAULT_APP_ICON_URL}
                alt=""
                draggable={false}
                className="h-8 w-8 object-cover object-top [image-rendering:pixelated]"
              />
            </button>
            {category.entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={cn(
                  "grid h-11 w-11 place-items-center rounded-md border border-transparent transition-colors hover:bg-accent",
                  entry.id === value && "border-ring bg-accent"
                )}
                title={entry.file}
                aria-label={entry.file}
                onClick={() => finish(entry.id)}
              >
                <img
                  src={appIconUrl(entry.id)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="h-8 w-8 object-cover object-top [image-rendering:pixelated]"
                />
              </button>
            ))}
          </div>
        </div>
      </WindowFrame>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<IconPicker />);
