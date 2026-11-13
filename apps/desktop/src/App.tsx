import { useEffect, useState } from "react";
import { useAppConfig } from "./config/useAppConfig";
import { findContainerStyle } from "./hud/inventoryStyles";
import {
  applyConfiguredVisibility,
  toggleCrosshair,
  toggleInventory,
  toggleSettings,
  toggleStatusBar
} from "./windowControls";

type BusyKey = "statusBar" | "inventory" | "crosshair" | "settings" | null;

export default function App() {
  const config = useAppConfig();
  const [busy, setBusy] = useState<BusyKey>(null);

  useEffect(() => {
    void applyConfiguredVisibility().catch(() => undefined);
  }, []);

  const run = async (key: Exclude<BusyKey, null>, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const styleName = findContainerStyle(config.inventory.style).name;
  const hotkeys = config.hotkeys;

  return (
    <main className="shell">
      <header className="shell-head">
        <div className="shell-title">
          <h1>CraftSharp</h1>
          <p>桌面 HUD 与壁纸工具</p>
        </div>
        <span className="version">0.1.0</span>
      </header>

      <section className="cards">
        <article className="card">
          <div className="card-head">
            <h2>状态栏</h2>
            <span className={config.statusBar.visible ? "state on" : "state"}>
              {config.statusBar.visible ? "显示中" : "已隐藏"}
            </span>
          </div>
          <p>生命、饥饿、护甲、经验与快捷栏，支持副手槽、文件名颜色与拖拽交换。</p>
          <div className="card-foot">
            <button
              type="button"
              onClick={() => void run("statusBar", toggleStatusBar)}
              disabled={busy !== null}
            >
              {config.statusBar.visible ? "隐藏状态栏" : "显示状态栏"}
            </button>
            <button type="button" className="ghost" onClick={() => void run("settings", toggleSettings)}>
              调整外观
            </button>
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <h2>物品栏</h2>
            <span className={config.inventory.visible ? "state on" : "state"}>
              {config.inventory.visible ? "打开中" : "已关闭"}
            </span>
          </div>
          <p>当前样式：{styleName}。支持拖拽交换、Shift 批量移动、中键分发与右键菜单。</p>
          <div className="card-foot">
            <button
              type="button"
              onClick={() => void run("inventory", toggleInventory)}
              disabled={busy !== null}
            >
              {config.inventory.visible ? "关闭物品栏" : "打开物品栏"}
            </button>
            <button type="button" className="ghost" onClick={() => void run("settings", toggleSettings)}>
              更换样式
            </button>
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <h2>准星</h2>
            <span className={config.hudElements.crosshairVisible ? "state on" : "state"}>
              {config.hudElements.crosshairVisible ? "显示中" : "已隐藏"}
            </span>
          </div>
          <p>屏幕居中的原版准星，可选攻击指示器，跟随当前缩放比例。</p>
          <div className="card-foot">
            <button
              type="button"
              onClick={() => void run("crosshair", toggleCrosshair)}
              disabled={busy !== null}
            >
              {config.hudElements.crosshairVisible ? "隐藏准星" : "显示准星"}
            </button>
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <h2>设置</h2>
            <span className="state">8 个分区</span>
          </div>
          <p>系统、外观、状态栏、快捷栏、物品栏、准星、热键与关于。</p>
          <div className="card-foot">
            <button type="button" onClick={() => void run("settings", toggleSettings)} disabled={busy !== null}>
              打开设置
            </button>
          </div>
        </article>
      </section>

      <footer className="shell-foot">
        <div className="hotkey-row">
          <span>{hotkeys.settings} 设置</span>
          <span>{hotkeys.statusBar} 状态栏</span>
          <span>{hotkeys.inventory} 物品栏</span>
          <span>{hotkeys.crosshair} 准星</span>
        </div>
        <p>Tauri 2 + Rust + React 重写，HUD 使用仓库内原版 Minecraft 纹理</p>
      </footer>
    </main>
  );
}
