import { useState, type ComponentType } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppConfig } from "./config/useAppConfig";
import { useResolvedTheme } from "./settings/theme";
import { AboutSection } from "./settings/sections/aboutSection";
import { AppearanceSection } from "./settings/sections/appearanceSection";
import { CrosshairSection } from "./settings/sections/crosshairSection";
import { HotbarSection } from "./settings/sections/hotbarSection";
import { HotkeysSection } from "./settings/sections/hotkeysSection";
import { InventorySection } from "./settings/sections/inventorySection";
import { StatusBarSection } from "./settings/sections/statusBarSection";
import { SystemSection } from "./settings/sections/systemSection";
import "./settings/settings.css";

type SectionId = "system" | "appearance" | "statusBar" | "hotbar" | "inventory" | "crosshair" | "hotkeys" | "about";

const NAV_ITEMS: { id: SectionId; label: string; Section: ComponentType }[] = [
  { id: "system", label: "系统", Section: SystemSection },
  { id: "appearance", label: "外观", Section: AppearanceSection },
  { id: "statusBar", label: "状态栏", Section: StatusBarSection },
  { id: "hotbar", label: "快捷栏", Section: HotbarSection },
  { id: "inventory", label: "物品栏", Section: InventorySection },
  { id: "crosshair", label: "准星", Section: CrosshairSection },
  { id: "hotkeys", label: "热键", Section: HotkeysSection },
  { id: "about", label: "关于", Section: AboutSection }
];

function closeWindow() {
  try {
    void getCurrentWindow().hide().catch(() => undefined);
  } catch {
    // 非 Tauri 环境（浏览器调试）没有窗口 API，直接忽略
  }
}

function SettingsApp() {
  const config = useAppConfig();
  const theme = useResolvedTheme(config.appearance.theme);
  const [active, setActive] = useState<SectionId>("system");
  const ActiveSection = NAV_ITEMS.find((item) => item.id === active)!.Section;

  return (
    <div className="settings-root" data-theme={theme}>
      <header className="titlebar" data-tauri-drag-region>
        <span className="titlebar-title" data-tauri-drag-region>
          CraftSharp 设置
        </span>
        <button type="button" className="titlebar-close" aria-label="关闭" onClick={closeWindow}>
          ×
        </button>
      </header>

      <div className="settings-body">
        <nav className="sidebar" aria-label="设置分区">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === active ? "nav-item is-active" : "nav-item"}
              aria-current={item.id === active ? "page" : undefined}
              onClick={() => setActive(item.id)}
            >
              {item.label}
            </button>
          ))}
          <div className="sidebar-footer">CraftSharp 0.1.0</div>
        </nav>

        {/* key 让切换分区时内容区回到顶部 */}
        <main className="content" key={active}>
          <ActiveSection />
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<SettingsApp />);
