import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getConfig } from "./config/appConfig";
import { applyConfiguredVisibility, applyWindowAction, setSettingsVisible, type WindowAction } from "./windowControls";

const ACTIONS: WindowAction[] = ["settings", "statusBar", "inventory", "crosshair"];

/**
 * 主窗口只承担宿主职责：初始化窗口显隐、监听托盘动作。
 * 产品入口是托盘与全局热键，不再提供卡片式主界面。
 */
export default function App() {
  useEffect(() => {
    void (async () => {
      await applyConfiguredVisibility().catch(() => undefined);
      if (getConfig().system.defaultOpenSettings) {
        await setSettingsVisible(true).catch(() => undefined);
      }
    })();

    const pending = listen<string>("tray-action", ({ payload }) => {
      if (ACTIONS.includes(payload as WindowAction)) {
        void applyWindowAction(payload as WindowAction);
      }
    });

    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, []);

  return null;
}
