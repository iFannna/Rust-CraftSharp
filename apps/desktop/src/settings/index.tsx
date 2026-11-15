import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import ReactDOM from "react-dom/client";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig, updateConfig } from "@/config/appConfig";
import { clampToWorkArea } from "@/hud/shared/windowPlacement";
import { useAppConfig } from "@/config/useAppConfig";
import { useResolvedTheme } from "@/settings/theme";
import { ensureSettingsFonts, fontStackOf } from "@/settings/fonts";
import { AboutSection } from "@/settings/sections/aboutSection";
import { AppearanceSection } from "@/settings/sections/appearanceSection";
import { HotkeysSection } from "@/settings/sections/hotkeysSection";
import { installLocalHotkeys } from "@/lib/localHotkeys";
import { HudSection } from "@/settings/sections/hudSection";
import { InventorySection } from "@/settings/sections/inventorySection";
import { SystemSection } from "@/settings/sections/systemSection";
import "@/settings/settings.css";

type SectionId = "system" | "appearance" | "hud" | "inventory" | "hotkeys" | "about";

ensureSettingsFonts();
installLocalHotkeys();

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
  { id: "hud", label: "HUD", glyph: "\uE80A", Section: HudSection },
  { id: "inventory", label: "物品栏", glyph: "\uE7B8", Section: InventorySection },
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
  const [active, setActive] = useState<SectionId>(() => {
    const system = getConfig().system;
    const saved = system.lastSection as SectionId;
    if (system.rememberNavSelection && NAV_ITEMS.some((item) => item.id === saved)) return saved;
    return "system";
  });
  const [maximized, setMaximized] = useState(false);
  const maximizedRef = useRef(false);
  const ActiveSection = NAV_ITEMS.find((item) => item.id === active)!.Section;

  useEffect(() => {
    maximizedRef.current = maximized;
  }, [maximized]);

  const selectSection = (id: SectionId) => {
    setActive(id);
    if (getConfig().system.rememberNavSelection) {
      updateConfig({ system: { lastSection: id } });
    }
  };

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

  // 记忆设置窗口的位置、大小与选中页，恢复时夹回当前工作区
  useEffect(() => {
    const current = windowApi();
    if (!current) return;

    let factor = window.devicePixelRatio || 1;
    let moveTimer = 0;
    let sizeTimer = 0;
    let pendingPosition: { x: number; y: number } | null = null;
    let pendingSize: { width: number; height: number } | null = null;
    const disposers: Array<() => void> = [];

    const flushPosition = () => {
      if (!pendingPosition) return;
      const position = pendingPosition;
      pendingPosition = null;
      if (!maximizedRef.current && getConfig().system.rememberWindowPosition) {
        updateConfig({ system: { windowPosition: position } });
      }
    };

    const flushSize = () => {
      if (!pendingSize) return;
      const size = pendingSize;
      pendingSize = null;
      if (!maximizedRef.current && getConfig().system.rememberWindowSize) {
        updateConfig({ system: { windowSize: size } });
      }
    };

    void (async () => {
      const system = getConfig().system;
      if (system.rememberWindowSize && system.windowSize) {
        await current.setSize(new LogicalSize(system.windowSize.width, system.windowSize.height)).catch(() => undefined);
      }
      if (system.rememberWindowPosition && system.windowPosition) {
        const size = system.windowSize ?? { width: 1080, height: 720 };
        const target = clampToWorkArea(system.windowPosition, size.width, size.height);
        if (target) {
          await current.setPosition(new LogicalPosition(target.x, target.y)).catch(() => undefined);
        }
      }
      factor = await current.scaleFactor().catch(() => factor);
    })();

    const onMoved = ({ payload }: { payload: { x: number; y: number } }) => {
      if (!getConfig().system.rememberWindowPosition || maximizedRef.current) return;
      pendingPosition = { x: Math.round(payload.x / factor), y: Math.round(payload.y / factor) };
      window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(flushPosition, 300);
    };

    const onResized = ({ payload }: { payload: { width: number; height: number } }) => {
      if (!getConfig().system.rememberWindowSize || maximizedRef.current) return;
      pendingSize = {
        width: Math.round(payload.width / factor),
        height: Math.round(payload.height / factor)
      };
      window.clearTimeout(sizeTimer);
      sizeTimer = window.setTimeout(flushSize, 300);
    };

    void current.onMoved(onMoved).then((dispose) => disposers.push(dispose)).catch(() => undefined);
    void current.onResized(onResized).then((dispose) => disposers.push(dispose)).catch(() => undefined);
    void current.onScaleChanged(({ payload }) => {
      factor = payload.scaleFactor;
    }).then((dispose) => disposers.push(dispose)).catch(() => undefined);

    return () => {
      window.clearTimeout(moveTimer);
      window.clearTimeout(sizeTimer);
      for (const dispose of disposers) dispose();
    };
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

  const fontStyle = {
    fontFamily: fontStackOf(config.appearance.font),
    "--ui-font": `${config.appearance.fontSize}px`
  } as CSSProperties;

  return (
    <div className="settings-root" data-theme={theme} style={fontStyle}>
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
                onClick={() => selectSection(item.id)}
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
