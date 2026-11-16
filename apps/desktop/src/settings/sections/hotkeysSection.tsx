import { useEffect, useState } from "react";
import type { HotkeysConfig } from "@/config/appConfig";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf, type MessageKey } from "@/i18n";
import { ActionBar, Button, Note, Row, SectionHead, SectionSubhead } from "@/settings/components/controls";
import { HotkeyInput } from "@/settings/components/hotkeyInput";

type HotkeyKey = "settings" | "statusBar" | "inventory" | "crosshair" | "desktopIcons" | "dropItem" | "openInventory";

const FAILURE_KEY = "craftsharp.hotkeyFailures";

function readFailures(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAILURE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

const HOTKEY_ITEMS: {
  key: HotkeyKey;
  labelKey: MessageKey;
  descKey: MessageKey;
  single?: boolean;
}[] = [
  { key: "settings", labelKey: "hotkeys.settingsLabel", descKey: "hotkeys.settingsDesc" },
  { key: "statusBar", labelKey: "hotkeys.statusBarLabel", descKey: "hotkeys.statusBarDesc" },
  { key: "inventory", labelKey: "hotkeys.inventoryLabel", descKey: "hotkeys.inventoryDesc" },
  { key: "crosshair", labelKey: "hotkeys.crosshairLabel", descKey: "hotkeys.crosshairDesc" },
  { key: "desktopIcons", labelKey: "hotkeys.desktopIconsLabel", descKey: "hotkeys.desktopIconsDesc" },
  { key: "dropItem", labelKey: "hotkeys.dropItemLabel", descKey: "hotkeys.dropItemDesc", single: true },
  {
    key: "openInventory",
    labelKey: "hotkeys.openInventoryLabel",
    descKey: "hotkeys.openInventoryDesc",
    single: true
  }
];

export function HotkeysSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [failed, setFailed] = useState<string[]>(readFailures);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === FAILURE_KEY) setFailed(readFailures());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const updateHotkey = (key: HotkeyKey, hotkey: string) => {
    const patch: Partial<HotkeysConfig> = {};
    patch[key] = hotkey;
    updateConfig({ hotkeys: patch });
  };

  const resetHotkeys = () => {
    const defaults = defaultConfig().hotkeys;
    updateConfig({
      hotkeys: {
        settings: defaults.settings,
        statusBar: defaults.statusBar,
        inventory: defaults.inventory,
        crosshair: defaults.crosshair,
        desktopIcons: defaults.desktopIcons,
        dropItem: defaults.dropItem,
        openInventory: defaults.openInventory
      }
    });
  };

  return (
    <>
      <SectionHead title={t("hotkeys.title")} />
      {failed.length > 0 ? (
        <Note tone="warning">
          {t("hotkeys.failed", { list: failed.join(t("common.listSeparator")) })}
        </Note>
      ) : null}
      <SectionSubhead>{t("hotkeys.global")}</SectionSubhead>
      {HOTKEY_ITEMS.filter((item) => !item.single).map((item) => (
        <Row key={item.key} label={t(item.labelKey)} description={t(item.descKey)}>
          <HotkeyInput
            value={config.hotkeys[item.key]}
            label={t(item.labelKey)}
            onChange={(hotkey) => updateHotkey(item.key, hotkey)}
          />
        </Row>
      ))}
      <SectionSubhead>{t("hotkeys.local")}</SectionSubhead>
      {HOTKEY_ITEMS.filter((item) => item.single).map((item) => (
        <Row key={item.key} label={t(item.labelKey)} description={t(item.descKey)}>
          <HotkeyInput
            value={config.hotkeys[item.key]}
            label={t(item.labelKey)}
            allowSingle
            onChange={(hotkey) => updateHotkey(item.key, hotkey)}
          />
        </Row>
      ))}
      <ActionBar>
        <Button onClick={resetHotkeys}>{t("common.restoreDefaults")}</Button>
      </ActionBar>
      <Note>{t("hotkeys.hint")}</Note>
    </>
  );
}
