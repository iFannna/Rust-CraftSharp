import { useEffect, useRef, useState, type ComponentType } from "react";
import ReactDOM from "react-dom/client";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig, updateConfig } from "@/config/appConfig";
import { clampToWorkArea } from "@/hud/shared/windowPlacement";
import { useAppConfig } from "@/config/useAppConfig";
import { ensureSettingsFonts } from "@/settings/fonts";
import { installLocalHotkeys } from "@/lib/localHotkeys";
import { isTauri } from "@/lib/runtime";
import { tOf, type MessageKey } from "@/i18n";
import { setSettingsVisible } from "@/lib/windowControls";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import { BugIcon, DashboardIcon, InfoIcon, KeyboardIcon, PackageIcon, PaletteIcon, SettingsIcon, UserIcon, type IconProps } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";
import { AboutSection } from "@/settings/sections/aboutSection";
import { AppearanceSection } from "@/settings/sections/appearanceSection";
import { DebugSection } from "@/settings/sections/debugSection";
import { HotkeysSection } from "@/settings/sections/hotkeysSection";
import { HudSection } from "@/settings/sections/hudSection";
import { InventorySection } from "@/settings/sections/inventorySection";
import { SkinSection } from "@/settings/sections/skinSection";
import { SystemSection } from "@/settings/sections/systemSection";
import "@/ui/styles.css";

type SectionId = "system" | "appearance" | "skin" | "hud" | "inventory" | "hotkeys" | "about" | "debug";

ensureSettingsFonts();
installLocalHotkeys();

interface NavItem {
  id: SectionId;
  labelKey: MessageKey;
  Icon: ComponentType<IconProps>;
  Section: ComponentType;
}

const NAV_ITEMS: NavItem[] = [
  { id: "system", labelKey: "nav.system", Icon: SettingsIcon, Section: SystemSection },
  { id: "appearance", labelKey: "nav.appearance", Icon: PaletteIcon, Section: AppearanceSection },
  { id: "skin", labelKey: "nav.skin", Icon: UserIcon, Section: SkinSection },
  { id: "hud", labelKey: "nav.hud", Icon: DashboardIcon, Section: HudSection },
  { id: "inventory", labelKey: "nav.inventory", Icon: PackageIcon, Section: InventorySection },
  { id: "hotkeys", labelKey: "nav.hotkeys", Icon: KeyboardIcon, Section: HotkeysSection },
  { id: "about", labelKey: "nav.about", Icon: InfoIcon, Section: AboutSection },
  { id: "debug", labelKey: "nav.debug", Icon: BugIcon, Section: DebugSection }
];

function windowApi() {
  return isTauri() ? getCurrentWindow() : null;
}

function SettingsApp() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [active, setActive] = useState<SectionId>(() => {
    const system = getConfig().system;
    const saved = system.lastSection as SectionId;
    if (system.rememberNavSelection && NAV_ITEMS.some((item) => item.id === saved)) return saved;
    return "system";
  });
  const maximizedRef = useRef(false);
  const ActiveSection = NAV_ITEMS.find((item) => item.id === active)!.Section;

  const syncMaximized = (value: boolean) => {
    maximizedRef.current = value;
  };

  useEffect(() => {
    const title = t("window.title");
    document.title = title;
    void windowApi()?.setTitle(title).catch(() => undefined);
  }, [config.system.language, t]);

  const selectSection = (id: SectionId) => {
    setActive(id);
    if (getConfig().system.rememberNavSelection) {
      updateConfig({ system: { lastSection: id } });
    }
  };

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

  const close = () => {
    // 关闭只隐藏窗口，托盘与后台窗口继续运行，与原版一致
    void setSettingsVisible(false);
  };

  return (
    <ThemeRoot>
      <WindowFrame
        title=""
        resizable
        onMaximizedChange={syncMaximized}
        onClose={close}
      >
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-56 flex-none flex-col p-2" aria-label={t("window.sections")}>
            <div className="flex flex-col gap-1">
              {NAV_ITEMS.map(({ id, labelKey, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                    id === active
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                  aria-current={id === active ? "page" : undefined}
                  onClick={() => selectSection(id)}
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  {t(labelKey)}
                </button>
              ))}
            </div>
            <div className="mt-auto px-3 py-3 text-xs text-muted-foreground">v26.11.17 Craft#</div>
          </nav>

          {/* key 让切换分区时内容区回到顶部 */}
          <main className="ui-scroll-auto settings-main min-w-0 flex-1 overflow-y-auto" key={active}>
            <div
              className={cn(
                "settings-content mx-auto max-w-[1120px] pb-10",
                active === "skin" && "flex h-full min-h-0 flex-col pb-6"
              )}
            >
              <ActiveSection />
            </div>
          </main>
        </div>
      </WindowFrame>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<SettingsApp />);
