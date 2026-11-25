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
import { Toaster } from "@/ui/components/sonner";
import { WindowFrame } from "@/ui/window-frame";
import { BugIcon, DashboardIcon, InfoIcon, KeyboardIcon, MonitorIcon, PackageIcon, PaletteIcon, SettingsIcon, UserIcon, type IconProps } from "@/ui/icons";
import { cn } from "@/ui/lib/utils";
import { AboutSection } from "@/settings/sections/aboutSection";
import { AppearanceSection } from "@/settings/sections/appearanceSection";
import { DebugSection } from "@/settings/sections/debugSection";
import { HotkeysSection } from "@/settings/sections/hotkeysSection";
import { HudSection } from "@/settings/sections/hudSection";
import { InventorySection } from "@/settings/sections/inventorySection";
import { SkinSection } from "@/settings/sections/skinSection";
import { SystemSection } from "@/settings/sections/systemSection";
import { WallpaperSection } from "@/settings/sections/wallpaperSection";
import "@/ui/styles.css";

type SectionId =
  | "system"
  | "appearance"
  | "wallpaper"
  | "skin"
  | "hud"
  | "inventory"
  | "hotkeys"
  | "about"
  | "debug";

/** 需要占满内容区高度的页面，由自身负责滚动 */
const FULL_HEIGHT_SECTIONS = new Set<SectionId>(["wallpaper", "skin"]);

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
  { id: "wallpaper", labelKey: "nav.wallpaper", Icon: MonitorIcon, Section: WallpaperSection },
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

/** 与 tauri.conf.json 中设置窗口的 minWidth / minHeight 保持一致 */
const MIN_WINDOW_SIZE = { width: 720, height: 480 };

/** 最小化时 Windows 会把窗口挪到 -32000 附近并报告标题栏大小的矩形 */
const OFFSCREEN_LIMIT = -30000;

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
  /** 启动恢复完成前不接受最大化状态变化，避免初始的未最大化把记忆覆盖掉 */
  const maximizedPersistReady = useRef(false);
  const ActiveSection = NAV_ITEMS.find((item) => item.id === active)!.Section;

  const syncMaximized = (value: boolean) => {
    maximizedRef.current = value;
    if (!maximizedPersistReady.current) return;
    const system = getConfig().system;
    // 最大化状态单独记忆，跟随「记住窗口大小」开关
    if (!system.rememberWindowSize || system.windowMaximized === value) return;
    if (value) {
      updateConfig({ system: { windowMaximized: true } });
      return;
    }
    // 最小化时 isMaximized 会变成 false，这个变化不代表用户取消了最大化
    const current = windowApi();
    if (!current) return;
    void current
      .isMinimized()
      .then((minimized) => {
        if (!minimized && getConfig().system.windowMaximized) {
          updateConfig({ system: { windowMaximized: false } });
        }
      })
      .catch(() => undefined);
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
      if (!getConfig().system.rememberWindowPosition) return;
      // maximizedRef 可能落后于事件，落盘前再向窗口确认一次
      void current.isMaximized().then((maximized) => {
        if (!maximized) updateConfig({ system: { windowPosition: position } });
      }).catch(() => undefined);
    };

    const flushSize = () => {
      if (!pendingSize) return;
      const size = pendingSize;
      pendingSize = null;
      if (!getConfig().system.rememberWindowSize) return;
      // 最大化尺寸不能写进还原尺寸，落盘前再向窗口确认一次
      void current.isMaximized().then((maximized) => {
        if (!maximized) updateConfig({ system: { windowSize: size } });
      }).catch(() => undefined);
    };

    void (async () => {
      const system = getConfig().system;
      // 旧版本可能把最小化矩形存成了尺寸，恢复时先夹到最小尺寸
      const savedSize = system.windowSize;
      const restoredSize = savedSize
        ? {
            width: Math.max(MIN_WINDOW_SIZE.width, Math.round(savedSize.width)),
            height: Math.max(MIN_WINDOW_SIZE.height, Math.round(savedSize.height))
          }
        : null;
      if (system.rememberWindowSize && restoredSize) {
        await current.setSize(new LogicalSize(restoredSize.width, restoredSize.height)).catch(() => undefined);
      }
      if (system.rememberWindowPosition && system.windowPosition) {
        const size = restoredSize ?? { width: 1080, height: 720 };
        const target = clampToWorkArea(system.windowPosition, size.width, size.height);
        if (target) {
          await current.setPosition(new LogicalPosition(target.x, target.y)).catch(() => undefined);
        }
      }
      factor = await current.scaleFactor().catch(() => factor);

      if (!system.rememberWindowSize || !system.windowMaximized) {
        maximizedPersistReady.current = true;
        return;
      }

      let maximizing = false;
      const applyMaximized = async () => {
        if (maximizing) return;
        maximizing = true;
        await current.maximize().catch(() => undefined);
        // 最大化落地后再放开状态记忆，挡住启动初期那次「未最大化」回写
        maximizedPersistReady.current = true;
      };

      // 尺寸和位置恢复完成后再还原最大化，保证最大化落在上次的显示器上
      if (await current.isVisible().catch(() => false)) {
        await applyMaximized();
        return;
      }
      // 隐藏窗口上最大化只改窗口样式、不会真正铺开，等首次显示聚焦后再执行
      disposers.push(
        await current.onFocusChanged(({ payload: focused }) => {
          if (!focused || maximizedPersistReady.current) return;
          void applyMaximized();
        })
      );
      // 注册监听前若窗口已经显示并聚焦，补一次执行
      if (await current.isVisible().catch(() => false)) {
        await applyMaximized();
      }
    })();

    const onMoved = ({ payload }: { payload: { x: number; y: number } }) => {
      if (!getConfig().system.rememberWindowPosition || maximizedRef.current) return;
      // 最小化时窗口被系统挪到屏幕外，这个坐标不是用户摆放的位置
      if (payload.x <= OFFSCREEN_LIMIT || payload.y <= OFFSCREEN_LIMIT) return;
      pendingPosition = { x: Math.round(payload.x / factor), y: Math.round(payload.y / factor) };
      window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(flushPosition, 300);
    };

    const onResized = ({ payload }: { payload: { width: number; height: number } }) => {
      if (!getConfig().system.rememberWindowSize || maximizedRef.current) return;
      const size = {
        width: Math.round(payload.width / factor),
        height: Math.round(payload.height / factor)
      };
      // 最小化时系统报告的是标题栏大小的矩形，小于最小尺寸的事件直接丢弃
      if (size.width < MIN_WINDOW_SIZE.width || size.height < MIN_WINDOW_SIZE.height) return;
      pendingSize = size;
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
                    "flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
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
            <div className="mt-auto px-3 py-3 text-xs text-muted-foreground">v26.11.25 Craft#</div>
          </nav>

          {/* key 让切换分区时内容区回到顶部 */}
          <main className="ui-scroll-auto settings-main min-w-0 flex-1 overflow-y-auto" key={active}>
            <div
              className={cn(
                "settings-content mx-auto max-w-[1120px] pb-10",
                FULL_HEIGHT_SECTIONS.has(active) && "flex h-full min-h-0 flex-col pb-6"
              )}
            >
              <ActiveSection />
            </div>
          </main>
        </div>
      </WindowFrame>
      <Toaster />
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<SettingsApp />);
