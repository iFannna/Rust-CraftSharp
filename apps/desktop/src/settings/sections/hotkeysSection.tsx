import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HotkeysConfig } from "@/config/appConfig";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf, type MessageKey } from "@/i18n";
import { HOTKEY_FAILURES_EVENT } from "@/lib/hotkeys";
import { ActionBar, Button, Note, Row, SectionHead, SectionSubhead } from "@/settings/components/controls";
import { confirmRestoreDefaults } from "@/settings/confirmRestore";
import { HotkeyInput } from "@/settings/components/hotkeyInput";
import { normalizeHotkey } from "@/settings/hotkey";

type HotkeyKey = "settings" | "statusBar" | "inventory" | "crosshair" | "desktopIcons" | "dropItem" | "openInventory";

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
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void invoke<string[]>("hotkey_failures")
      .then((list) => {
        if (alive) setFailed(list);
      })
      .catch(() => undefined);
    const stop = listen<string[]>(HOTKEY_FAILURES_EVENT, (event) => setFailed(event.payload));
    return () => {
      alive = false;
      void stop.then((off) => off());
    };
  }, []);

  const updateHotkey = (key: HotkeyKey, hotkey: string) => {
    const patch: Partial<HotkeysConfig> = {};
    patch[key] = hotkey;
    updateConfig({ hotkeys: patch });
  };

  const occupiedBy = (key: HotkeyKey, hotkey: string): string | null => {
    const target = normalizeHotkey(hotkey);
    if (!target) return null;
    const occupied = HOTKEY_ITEMS.find(
      (item) => item.key !== key && normalizeHotkey(config.hotkeys[item.key]) === target
    );
    return occupied ? t(occupied.labelKey) : null;
  };

  const resetHotkeys = async () => {
    if (!(await confirmRestoreDefaults(t))) return;
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
            conflictLabel={(hotkey) => occupiedBy(item.key, hotkey)}
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
            conflictLabel={(hotkey) => occupiedBy(item.key, hotkey)}
            onChange={(hotkey) => updateHotkey(item.key, hotkey)}
          />
        </Row>
      ))}
      <ActionBar>
        <Button onClick={resetHotkeys}>{t("common.restoreDefaults")}</Button>
      </ActionBar>
    </>
  );
}
