import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { languageOptions } from "@/settings/options";
import { stripHotkeySides } from "@/settings/hotkey";
import { ActionBar, Button, Note, Row, SectionHead, SectionSubhead, Select, Toggle } from "@/settings/components/controls";
import { TrayControls } from "@/settings/sections/system/trayControls";
import { confirmRestoreDefaults } from "@/settings/confirmRestore";

export function SystemSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [autoStartFailed, setAutoStartFailed] = useState(false);

  const resetSystem = async () => {
    if (!(await confirmRestoreDefaults(t))) return;
    const defaults = defaultConfig();
    updateConfig({ system: defaults.system, tray: defaults.tray });
    // 配置里关闭自启还不够，注册表项也要一起移除
    if ("__TAURI_INTERNALS__" in window) {
      void invoke("set_autostart", { enabled: false })
        .then(() => setAutoStartFailed(false))
        .catch(() => setAutoStartFailed(true));
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
            void invoke("set_autostart", { enabled: autoStart })
              .then(() => {
                setAutoStartFailed(false);
                updateConfig({ system: { autoStart } });
              })
              .catch(() => setAutoStartFailed(true));
          }}
        />
      </Row>
      {autoStartFailed ? <Note tone="warning">{t("system.autoStartError")}</Note> : null}
      <Row label={t("system.defaultOpenLabel")} description={t("system.defaultOpenDesc")}>
        <Toggle
          checked={config.system.defaultOpenSettings}
          label={t("system.defaultOpenLabel")}
          onChange={(defaultOpenSettings) => updateConfig({ system: { defaultOpenSettings } })}
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
      <ActionBar>
        <Button onClick={resetSystem}>{t("common.restoreDefaults")}</Button>
      </ActionBar>
    </>
  );
}
