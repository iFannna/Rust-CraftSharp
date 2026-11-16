import { useEffect, useRef, useState } from "react";
import type { TFunction } from "@/i18n";
import { DEFAULT_TRAY_ICON, DEFAULT_TRAY_ICON_URL, TRAY_ICON_GROUPS, trayIconUrl } from "@/settings/trayIcons";

interface TrayIconPickerProps {
  value: string;
  t: TFunction;
  onPick: (id: string) => void;
  onClose: () => void;
}

/** 托盘图标选择：老版分类结构，选中即应用并关闭 */
export function TrayIconPicker({ value, t, onPick, onClose }: TrayIconPickerProps) {
  const [active, setActive] = useState(
    () => `${TRAY_ICON_GROUPS[0].id}:${TRAY_ICON_GROUPS[0].categories[0].id}`
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;

  const [groupId, categoryId] = active.split(":");
  const group = TRAY_ICON_GROUPS.find((item) => item.id === groupId) ?? TRAY_ICON_GROUPS[0];
  const category = group.categories.find((item) => item.id === categoryId) ?? group.categories[0];

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHandler.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="icon-picker-backdrop">
      <div className="icon-picker" role="dialog" aria-modal="true" aria-label={t("iconPicker.title")}>
        <header className="icon-picker-header">
          <span>{t("iconPicker.title")}</span>
          <button
            ref={closeRef}
            type="button"
            className="icon-picker-close"
            aria-label={t("window.close")}
            onClick={onClose}
          >
            {"\uE8BB"}
          </button>
        </header>

        <div className="icon-picker-body">
          <nav className="icon-picker-nav" aria-label={t("iconPicker.title")}>
            {TRAY_ICON_GROUPS.map((item) => (
              <div key={item.id}>
                <div className="icon-picker-group">{t(item.labelKey)}</div>
                {item.categories.map((entry) => {
                  const key = `${item.id}:${entry.id}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={key === active ? "icon-picker-category is-active" : "icon-picker-category"}
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

          <div className="icon-picker-grid">
            <button
              type="button"
              className={value === DEFAULT_TRAY_ICON ? "icon-picker-cell is-selected" : "icon-picker-cell"}
              title={t("iconPicker.defaultIcon")}
              aria-label={t("iconPicker.defaultIcon")}
              onClick={() => onPick(DEFAULT_TRAY_ICON)}
            >
              <img src={DEFAULT_TRAY_ICON_URL} alt="" draggable={false} />
            </button>
            {category.entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === value ? "icon-picker-cell is-selected" : "icon-picker-cell"}
                title={entry.file}
                aria-label={entry.file}
                onClick={() => onPick(entry.id)}
              >
                <img src={trayIconUrl(entry.id)} alt="" loading="lazy" decoding="async" draggable={false} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
