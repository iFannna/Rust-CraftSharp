/**
 * 应用配置，字段对齐原 AppSettings，暂存 localStorage。
 * 后续迁移 settings.json 时只替换本文件的读写实现。
 */

export type ClickMode = "single" | "double";
export type ThemeMode = "system" | "light" | "dark";
export type LanguageCode = "zh-CN" | "en-US";
export type SkinType = "wide" | "slim";

export interface PositionConfig {
  x: number;
  y: number;
}

export interface SystemConfig {
  language: LanguageCode;
  autoStart: boolean;
  defaultOpenSettings: boolean;
}

export interface AppearanceConfig {
  theme: ThemeMode;
}

export interface StatusBarConfig {
  visible: boolean;
  locked: boolean;
  position: PositionConfig | null;
}

export interface HotbarConfig {
  visible: boolean;
  leftOffhand: boolean;
  rightOffhand: boolean;
  clickMode: ClickMode;
  hoverEffect: boolean;
  showTargetIcon: boolean;
  fileNameColor: string;
}

export interface InventoryConfig {
  visible: boolean;
  locked: boolean;
  rememberPosition: boolean;
  position: PositionConfig | null;
  grayOverlay: boolean;
  grayOverlayOpacity: number;
  hideStatusBar: boolean;
  clickMode: ClickMode;
  style: string;
  sharedData: boolean;
  hoverEffect: boolean;
  showTooltip: boolean;
  tooltipShowFileName: boolean;
  tooltipShowOriginalName: boolean;
  tooltipShowFilePath: boolean;
  tooltipShowFileType: boolean;
  fileNameColor: string;
}

export interface HudElementsConfig {
  crosshairVisible: boolean;
  attackIndicatorVisible: boolean;
  bossBarVisible: boolean;
}

export interface HotkeysConfig {
  settings: string;
  statusBar: string;
  inventory: string;
  crosshair: string;
  dropItem: string;
}

export interface PlayerConfig {
  skinPath: string;
  skinType: SkinType;
}

export interface AppConfig {
  version: number;
  system: SystemConfig;
  appearance: AppearanceConfig;
  statusBar: StatusBarConfig;
  hotbar: HotbarConfig;
  inventory: InventoryConfig;
  hudElements: HudElementsConfig;
  hotkeys: HotkeysConfig;
  player: PlayerConfig;
}

const STORAGE_KEY = "craftsharp.config.v1";
const LEGACY_INVENTORY_KEY = "craftsharp.inventory.v1";

export const CONFIG_VERSION = 1;

const DEFAULTS: AppConfig = {
  version: CONFIG_VERSION,
  system: { language: "zh-CN", autoStart: false, defaultOpenSettings: false },
  appearance: { theme: "dark" },
  statusBar: { visible: true, locked: false, position: null },
  hotbar: {
    visible: true,
    leftOffhand: false,
    rightOffhand: false,
    clickMode: "double",
    hoverEffect: true,
    showTargetIcon: false,
    fileNameColor: "#FCFCFC"
  },
  inventory: {
    visible: false,
    locked: true,
    rememberPosition: true,
    position: null,
    grayOverlay: true,
    grayOverlayOpacity: 75,
    hideStatusBar: false,
    clickMode: "single",
    style: "inventory.png",
    sharedData: true,
    hoverEffect: true,
    showTooltip: false,
    tooltipShowFileName: true,
    tooltipShowOriginalName: false,
    tooltipShowFilePath: false,
    tooltipShowFileType: false,
    fileNameColor: "#FCFCFC"
  },
  hudElements: { crosshairVisible: true, attackIndicatorVisible: true, bossBarVisible: false },
  hotkeys: {
    settings: "Ctrl+Alt+S",
    statusBar: "Ctrl+Alt+H",
    inventory: "Ctrl+Alt+E",
    crosshair: "Ctrl+Alt+C",
    dropItem: "Q"
  },
  player: { skinPath: "", skinType: "wide" }
};

export function defaultConfig(): AppConfig {
  return structuredClone(DEFAULTS);
}

function mergeConfig(base: AppConfig, raw: Partial<AppConfig>): AppConfig {
  return {
    version: CONFIG_VERSION,
    system: { ...base.system, ...raw.system },
    appearance: { ...base.appearance, ...raw.appearance },
    statusBar: { ...base.statusBar, ...raw.statusBar },
    hotbar: { ...base.hotbar, ...raw.hotbar },
    inventory: { ...base.inventory, ...raw.inventory },
    hudElements: { ...base.hudElements, ...raw.hudElements },
    hotkeys: { ...base.hotkeys, ...raw.hotkeys },
    player: { ...base.player, ...raw.player }
  };
}

function migrateLegacyInventory(config: AppConfig): AppConfig {
  try {
    const raw = localStorage.getItem(LEGACY_INVENTORY_KEY);
    if (!raw) return config;
    const legacy = JSON.parse(raw) as Record<string, unknown>;
    return mergeConfig(config, {
      inventory: {
        ...config.inventory,
        style: typeof legacy.style === "string" ? legacy.style : config.inventory.style,
        sharedData: typeof legacy.sharedData === "boolean" ? legacy.sharedData : config.inventory.sharedData,
        clickMode: legacy.clickMode === "double" ? "double" : legacy.clickMode === "single" ? "single" : config.inventory.clickMode,
        hoverEffect: typeof legacy.hoverEffect === "boolean" ? legacy.hoverEffect : config.inventory.hoverEffect,
        showTooltip: typeof legacy.showTooltip === "boolean" ? legacy.showTooltip : config.inventory.showTooltip,
        grayOverlay: typeof legacy.grayOverlay === "boolean" ? legacy.grayOverlay : config.inventory.grayOverlay,
        grayOverlayOpacity: typeof legacy.grayOverlayOpacity === "number" ? legacy.grayOverlayOpacity : config.inventory.grayOverlayOpacity,
        locked: typeof legacy.lockPosition === "boolean" ? legacy.lockPosition : config.inventory.locked,
        rememberPosition: typeof legacy.rememberPosition === "boolean" ? legacy.rememberPosition : config.inventory.rememberPosition,
        position: (legacy.position as PositionConfig | null) ?? config.inventory.position
      }
    });
  } catch {
    return config;
  }
}

function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrateLegacyInventory(defaultConfig());
    return mergeConfig(DEFAULTS, JSON.parse(raw) as Partial<AppConfig>);
  } catch {
    return defaultConfig();
  }
}

let config = loadConfig();
const listeners = new Set<() => void>();

export function getConfig(): AppConfig {
  return config;
}

export type ConfigPatch = {
  [K in keyof Omit<AppConfig, "version">]?: Partial<AppConfig[K]>;
};

export function updateConfig(patch: ConfigPatch) {
  config = mergeConfig(config, patch as Partial<AppConfig>);
  persist();
  notify();
}

export function replaceConfig(next: AppConfig) {
  config = mergeConfig(DEFAULTS, next);
  persist();
  notify();
}

export function resetConfig() {
  config = defaultConfig();
  persist();
  notify();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 存储不可用时只保留内存态
  }
}

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  config = loadConfig();
  notify();
});
