import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { languageOptions } from "@/settings/options";
import { stripHotkeySides } from "@/settings/hotkey";
import { ActionBar, Button, Row, SectionHead, SectionSubhead, Select, Toggle } from "@/settings/components/controls";
import { TrayControls } from "@/settings/sections/system/trayControls";
import { StorageControls } from "@/settings/sections/system/storageControls";
import { confirmRestoreDefaults } from "@/settings/confirmRestore";

export function SystemSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [storageReset, setStorageReset] = useState(0);

  const autoStartFailed = (reason: unknown) => {
    console.error(reason);
    toast.info(t("system.autoStartError"));
  };

  const resetSystem = async () => {
    if (!(await confirmRestoreDefaults(t))) return;
    const defaults = defaultConfig();
    updateConfig({ system: defaults.system, tray: defaults.tray });
    setStorageReset((value) => value + 1);
    toast.success(t("common.restoreDone"));
    // 配置里关闭自启还不够，系统启动项也要一起移除
    if ("__TAURI_INTERNALS__" in window) {
      void invoke("set_autostart", { enabled: false, openSettings: false }).catch(autoStartFailed);
    }
  };

  return (
    <>
      <SectionHead title={t("system.title")} />
      <SectionSubhead>{t("system.basicSettings")}</SectionSubhead>
      <Row label={t("system.languageLabel")} description={t("system.languageDesc")}>
        <Select
          value={config.system.language}
          options={languageOptions()}
          ariaLabel={t("system.languageAria")}
          onChange={(language) => updateConfig({ system: { language } })}
        />
      </Row>
      <Row label={t("system.autoStartLabel")} description={t("system.autoStartDesc")}>
        <Toggle
          checked={config.system.autoStart}
          label={t("system.autoStartLabel")}
          onChange={(autoStart) => {
            if (!("__TAURI_INTERNALS__" in window)) {
              updateConfig({ system: { autoStart } });
              return;
            }
            void invoke("set_autostart", {
              enabled: autoStart,
              openSettings: config.system.defaultOpenSettings
            })
              .then(() => updateConfig({ system: { autoStart } }))
              .catch(autoStartFailed);
          }}
        />
      </Row>
      <Row label={t("system.defaultOpenLabel")} description={t("system.defaultOpenDesc")}>
        <Toggle
          checked={config.system.defaultOpenSettings}
          label={t("system.defaultOpenLabel")}
          onChange={(defaultOpenSettings) => {
            updateConfig({ system: { defaultOpenSettings } });
            // Linux 的登录自启项里带着这个开关，已开启时同步改写
            if (config.system.autoStart && "__TAURI_INTERNALS__" in window) {
              void invoke("set_autostart", { enabled: true, openSettings: defaultOpenSettings }).catch(
                autoStartFailed
              );
            }
          }}
        />
      </Row>
      <Row label={t("system.rememberPositionLabel")} description={t("system.rememberPositionDesc")}>
        <Toggle
          checked={config.system.rememberWindowPosition}
          label={t("system.rememberPositionLabel")}
          onChange={(rememberWindowPosition) => updateConfig({ system: { rememberWindowPosition } })}
        />
      </Row>
      <Row label={t("system.rememberSizeLabel")} description={t("system.rememberSizeDesc")}>
        <Toggle
          checked={config.system.rememberWindowSize}
          label={t("system.rememberSizeLabel")}
          onChange={(rememberWindowSize) => updateConfig({ system: { rememberWindowSize } })}
        />
      </Row>
      <Row label={t("system.rememberCardsLabel")} description={t("system.rememberCardsDesc")}>
        <Toggle
          checked={config.system.rememberCardStates}
          label={t("system.rememberCardsLabel")}
          onChange={(rememberCardStates) => updateConfig({ system: { rememberCardStates } })}
        />
      </Row>
      <Row label={t("system.rememberNavLabel")} description={t("system.rememberNavDesc")}>
        <Toggle
          checked={config.system.rememberNavSelection}
          label={t("system.rememberNavLabel")}
          onChange={(rememberNavSelection) => updateConfig({ system: { rememberNavSelection } })}
        />
      </Row>
      <SectionSubhead>{t("system.traySettings")}</SectionSubhead>
      <TrayControls />
      <SectionSubhead>{t("system.hotkeySettings")}</SectionSubhead>
      <Row label={t("system.distinguishModifiersLabel")} description={t("system.distinguishModifiersDesc")}>
        <Toggle
          checked={config.system.distinguishModifiers}
          label={t("system.distinguishModifiersLabel")}
          onChange={(distinguishModifiers) =>
            updateConfig({
              system: { distinguishModifiers },
              ...(distinguishModifiers ? {} : { hotkeys: stripHotkeySides(config.hotkeys) })
            })
          }
        />
      </Row>
      <StorageControls resetSignal={storageReset} />
      <ActionBar>
        <Button onClick={resetSystem}>{t("common.restoreDefaults")}</Button>
      </ActionBar>
    </>
  );
}
