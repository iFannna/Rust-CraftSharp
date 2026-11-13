import { useEffect, useState, type ComponentType } from "react";
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

interface NavItem {
  id: SectionId;
  label: string;
  /** Segoe Fluent Icons 字形，与原版 wpf-ui SymbolIcon 一致 */
  glyph: string;
  Section: ComponentType;
}

const NAV_ITEMS: NavItem[] = [
  { id: "system", label: "系统", glyph: "\uE713", Section: SystemSection },
  { id: "appearance", label: "外观", glyph: "\uE790", Section: AppearanceSection },
  { id: "statusBar", label: "状态栏", glyph: "\uE7F4", Section: StatusBarSection },
  { id: "hotbar", label: "快捷栏", glyph: "\uE8FD", Section: HotbarSection },
  { id: "inventory", label: "物品栏", glyph: "\uE7B8", Section: InventorySection },
  { id: "crosshair", label: "准星", glyph: "\uE710", Section: CrosshairSection },
  { id: "hotkeys", label: "快捷键", glyph: "\uE765", Section: HotkeysSection },
  { id: "about", label: "关于", glyph: "\uE946", Section: AboutSection }
];

/** @tauri-apps/api 未导出该联合类型，这里按 startResizeDragging 的取值定义 */
type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const RESIZE_EDGES: { direction: ResizeDirection; className: string }[] = [
  { direction: "North", className: "resize-north" },
  { direction: "South", className: "resize-south" },
  { direction: "East", className: "resize-east" },
  { direction: "West", className: "resize-west" },
  { direction: "NorthEast", className: "resize-north-east" },
  { direction: "NorthWest", className: "resize-north-west" },
  { direction: "SouthEast", className: "resize-south-east" },
  { direction: "SouthWest", className: "resize-south-west" }
];

const isTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function windowApi() {
  return isTauriRuntime() ? getCurrentWindow() : null;
}

function SettingsApp() {
  const config = useAppConfig();
  const theme = useResolvedTheme(config.appearance.theme);
  const [active, setActive] = useState<SectionId>("system");
  const [maximized, setMaximized] = useState(false);
  const ActiveSection = NAV_ITEMS.find((item) => item.id === active)!.Section;

  useEffect(() => {
    const current = windowApi();
    if (!current) return;

    let unlisten: (() => void) | undefined;
    const syncMaximized = () => {
      void current.isMaximized().then(setMaximized).catch(() => undefined);
    };
    syncMaximized();
    void current.onResized(syncMaximized).then((dispose) => {
      unlisten = dispose;
    }).catch(() => undefined);

    return () => unlisten?.();
  }, []);

  const minimize = () => {
    void windowApi()?.minimize().catch(() => undefined);
  };

  const toggleMaximize = () => {
    void windowApi()?.toggleMaximize().catch(() => undefined);
  };

  const close = () => {
    // 关闭只隐藏窗口，托盘与后台窗口继续运行，与原版一致
    void windowApi()?.hide().catch(() => undefined);
  };

  return (
    <div className="settings-root" data-theme={theme}>
      {maximized
        ? null
        : RESIZE_EDGES.map((edge) => (
            <div
              key={edge.direction}
              className={`resize-handle ${edge.className}`}
              aria-hidden="true"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                void windowApi()?.startResizeDragging(edge.direction).catch(() => undefined);
              }}
            />
          ))}

      <header className="titlebar" data-tauri-drag-region>
        <span className="titlebar-title" data-tauri-drag-region>
          Craft#
        </span>
        <div className="caption-buttons">
          <button type="button" className="caption-button" aria-label="最小化" onClick={minimize}>
            <span aria-hidden="true">{"\uE921"}</span>
          </button>
          <button
            type="button"
            className="caption-button"
            aria-label={maximized ? "还原" : "最大化"}
            onClick={toggleMaximize}
          >
            <span aria-hidden="true">{maximized ? "\uE923" : "\uE922"}</span>
          </button>
          <button type="button" className="caption-button is-close" aria-label="关闭" onClick={close}>
            <span aria-hidden="true">{"\uE8BB"}</span>
          </button>
        </div>
      </header>

      <div className="settings-body">
        <nav className="sidebar" aria-label="设置分区">
          <div className="nav-list">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === active ? "nav-item is-active" : "nav-item"}
                aria-current={item.id === active ? "page" : undefined}
                onClick={() => setActive(item.id)}
              >
                <span className="nav-icon" aria-hidden="true">
                  {item.glyph}
                </span>
                {item.label}
              </button>
            ))}
          </div>
          <div className="sidebar-footer">v0.1.0 Craft#</div>
        </nav>

        {/* key 让切换分区时内容区回到顶部 */}
        <main className="content" key={active}>
          <div className="content-inner">
            <ActiveSection />
          </div>
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<SettingsApp />);
