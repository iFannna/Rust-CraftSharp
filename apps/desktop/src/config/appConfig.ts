/**
 * 应用配置，字段对齐原 AppSettings，暂存 localStorage。
 * 后续迁移 settings.json 时只替换本文件的读写实现。
 */

import { isLanguage, type LanguageCode } from "@/i18n";

export type { LanguageCode };

export type ClickMode = "single" | "double";
export type ThemeMode = "system" | "light" | "dark";
export type SkinType = "wide" | "slim";
export type UIFont = "yahei" | "pixel" | "unifont" | "songti" | "kaiti" | "heiti";

export interface PositionConfig {
  x: number;
  y: number;
}

export interface WindowSizeConfig {
  width: number;
  height: number;
}

export interface SystemConfig {
  language: LanguageCode;
  autoStart: boolean;
  defaultOpenSettings: boolean;
  rememberWindowPosition: boolean;
  rememberWindowSize: boolean;
  rememberNavSelection: boolean;
  rememberCardStates: boolean;
  cardExpandedStates: Record<string, boolean>;
  windowPosition: PositionConfig | null;
  windowSize: WindowSizeConfig | null;
  lastSection: string;
}

export interface AppearanceConfig {
  theme: ThemeMode;
  font: UIFont;
  fontSize: number;
}

export interface StatusBarConfig {
  visible: boolean;
  locked: boolean;
  rememberPosition: boolean;
  position: PositionConfig | null;
  /** 记录位置时的窗口高度，换缩放比例时用它换算底边 */
  positionHeight?: number;
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

export type HudElementId = "health" | "food" | "air" | "armor" | "absorbing" | "expBar";

export interface HudElementConfig {
  visible: boolean;
  iconStyle: string;
  /** 生命值与空气值的变化动画 */
  regenAnimation: boolean;
  /** 饥饿值饱和度 */
  saturationValue: number;
  dataMappingEnabled: boolean;
  dataMappingType: DataMappingType;
  customValueEnabled: boolean;
  currentValue: number;
  maxValue: number;
}

export interface AttackIndicatorConfig {
  dataMappingEnabled: boolean;
  dataMappingType: DataMappingType;
  customValueEnabled: boolean;
  currentValue: number;
}

export interface HudElementsConfig {
  crosshairVisible: boolean;
  attackIndicatorVisible: boolean;
  crosshairTopMost: boolean;
  attackIndicator: AttackIndicatorConfig;
  elements: Record<HudElementId, HudElementConfig>;
}

export type BossBarColor = "blue" | "green" | "pink" | "purple" | "red" | "white" | "yellow";
export type BossBarNotch = "notched_6" | "notched_10" | "notched_12" | "notched_20";
export type DataMappingType = "battery" | "memory" | "cpu" | "gpu";

export interface BossBarConfig {
  id: string;
  name: string;
  color: BossBarColor;
  notch: BossBarNotch | null;
  enabled: boolean;
  dataMappingEnabled: boolean;
  dataMappingType: DataMappingType;
  customValueEnabled: boolean;
  currentValue: number;
}

export interface HotkeysConfig {
  settings: string;
  statusBar: string;
  inventory: string;
  crosshair: string;
  desktopIcons: string;
  dropItem: string;
  openInventory: string;
}

export interface PlayerConfig {
  skinPath: string;
  skinType: SkinType;
  skinName: string;
}

export interface AppConfig {
  version: number;
  system: SystemConfig;
  appearance: AppearanceConfig;
  statusBar: StatusBarConfig;
  hotbar: HotbarConfig;
  inventory: InventoryConfig;
  hudElements: HudElementsConfig;
  bossBars: BossBarConfig[];
  hotkeys: HotkeysConfig;
  player: PlayerConfig;
}

export const BOSS_BAR_COLORS: BossBarColor[] = ["blue", "green", "pink", "purple", "red", "white", "yellow"];
export const BOSS_BAR_NOTCHES: BossBarNotch[] = ["notched_6", "notched_10", "notched_12", "notched_20"];
export const DATA_MAPPING_TYPES: DataMappingType[] = ["battery", "memory", "cpu", "gpu"];

const STORAGE_KEY = "craftsharp.config.v1";
const LEGACY_INVENTORY_KEY = "craftsharp.inventory.v1";

export const CONFIG_VERSION = 1;

function defaultHudElement(maxValue = 20): HudElementConfig {
  return {
    visible: true,
    iconStyle: "",
    regenAnimation: false,
    saturationValue: 0,
    dataMappingEnabled: false,
    dataMappingType: "battery",
    customValueEnabled: false,
    currentValue: maxValue,
    maxValue
  };
}

const DEFAULT_ELEMENTS: Record<HudElementId, HudElementConfig> = {
  health: defaultHudElement(),
  food: defaultHudElement(),
  air: defaultHudElement(),
  armor: defaultHudElement(),
  absorbing: defaultHudElement(),
  expBar: { ...defaultHudElement(100), currentValue: 100 }
};

const DEFAULTS: AppConfig = {
  version: CONFIG_VERSION,
  system: {
    language: "zh-CN",
    autoStart: false,
    defaultOpenSettings: false,
    rememberWindowPosition: true,
    rememberWindowSize: true,
    rememberNavSelection: true,
    rememberCardStates: true,
    cardExpandedStates: {},
    windowPosition: null,
    windowSize: null,
    lastSection: "system"
  },
  appearance: { theme: "dark", font: "yahei", fontSize: 14 },
  statusBar: { visible: true, locked: false, rememberPosition: true, position: null },
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
  hudElements: {
    crosshairVisible: true,
    attackIndicatorVisible: true,
    crosshairTopMost: false,
    attackIndicator: {
      dataMappingEnabled: false,
      dataMappingType: "battery",
      customValueEnabled: true,
      currentValue: 100
    },
    elements: DEFAULT_ELEMENTS
  },
  bossBars: [],
  hotkeys: {
    settings: "Ctrl+Alt+S",
    statusBar: "Ctrl+Alt+H",
    inventory: "Ctrl+Alt+E",
    crosshair: "Ctrl+Alt+C",
    desktopIcons: "Ctrl+Alt+D",
    dropItem: "Q",
    openInventory: "E"
  },
  player: { skinPath: "", skinType: "wide", skinName: "steve" }
};

export function defaultConfig(): AppConfig {
  return structuredClone(DEFAULTS);
}

function mergeHudElements(base: HudElementsConfig, raw?: Partial<HudElementsConfig>): HudElementsConfig {
  if (!raw) return base;
  const elements = { ...base.elements };
  const incoming = raw.elements as Partial<Record<HudElementId, Partial<HudElementConfig>>> | undefined;

  if (incoming) {
    for (const id of Object.keys(elements) as HudElementId[]) {
      const item = incoming[id];
      if (!item) continue;
      const fallback = elements[id];
      elements[id] = {
        visible: item.visible !== false,
        iconStyle: typeof item.iconStyle === "string" ? item.iconStyle : "",
        regenAnimation: item.regenAnimation === true,
        saturationValue: clampInt(item.saturationValue, 0, 9999, fallback.saturationValue),
        dataMappingEnabled: item.dataMappingEnabled === true,
        dataMappingType: DATA_MAPPING_TYPES.includes(item.dataMappingType as DataMappingType)
          ? (item.dataMappingType as DataMappingType)
          : fallback.dataMappingType,
        customValueEnabled: item.customValueEnabled === true,
        currentValue: clampInt(item.currentValue, 0, 9999, fallback.currentValue),
        maxValue: clampInt(item.maxValue, 1, 9999, fallback.maxValue)
      };
    }
  }

  const indicator = raw.attackIndicator ?? base.attackIndicator;
  return {
    crosshairVisible: raw.crosshairVisible !== false,
    attackIndicatorVisible: raw.attackIndicatorVisible !== false,
    crosshairTopMost: raw.crosshairTopMost === true,
    attackIndicator: {
      dataMappingEnabled: indicator.dataMappingEnabled === true,
      dataMappingType: DATA_MAPPING_TYPES.includes(indicator.dataMappingType as DataMappingType)
        ? (indicator.dataMappingType as DataMappingType)
        : base.attackIndicator.dataMappingType,
      customValueEnabled: indicator.customValueEnabled !== false,
      currentValue: clampInt(indicator.currentValue, 0, 100, base.attackIndicator.currentValue)
    },
    elements
  };
}

function normalizeBossBars(value: unknown): BossBarConfig[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Partial<BossBarConfig>;
    const color = BOSS_BAR_COLORS.includes(raw.color as BossBarColor) ? (raw.color as BossBarColor) : "blue";
    const notch = BOSS_BAR_NOTCHES.includes(raw.notch as BossBarNotch) ? (raw.notch as BossBarNotch) : null;
    const mapping = DATA_MAPPING_TYPES.includes(raw.dataMappingType as DataMappingType)
      ? (raw.dataMappingType as DataMappingType)
      : "battery";
    return [{
      id: typeof raw.id === "string" && raw.id ? raw.id : `boss_${index}`,
      name: typeof raw.name === "string" ? raw.name : "",
      color,
      notch,
      enabled: raw.enabled !== false,
      dataMappingEnabled: raw.dataMappingEnabled === true,
      dataMappingType: mapping,
      customValueEnabled: raw.customValueEnabled !== false,
      currentValue: clampInt(raw.currentValue, 0, 100, 100)
    }];
  });
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function mergeConfig(base: AppConfig, raw: Partial<AppConfig>): AppConfig {
  const language = raw.system?.language;
  return {
    version: CONFIG_VERSION,
    system: {
      ...base.system,
      ...raw.system,
      language: isLanguage(language) ? language : base.system.language
    },
    appearance: {
      theme: raw.appearance?.theme ?? base.appearance.theme,
      font: raw.appearance?.font ?? base.appearance.font,
      fontSize: clampInt(raw.appearance?.fontSize, 10, 20, base.appearance.fontSize)
    },
    statusBar: { ...base.statusBar, ...raw.statusBar },
    hotbar: { ...base.hotbar, ...raw.hotbar },
    inventory: { ...base.inventory, ...raw.inventory },
    hudElements: mergeHudElements(base.hudElements, raw.hudElements),
    bossBars: Array.isArray(raw.bossBars) ? normalizeBossBars(raw.bossBars) : base.bossBars,
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
