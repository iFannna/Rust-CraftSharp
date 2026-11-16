/** 设置面板下拉选项：值到文案 key 的映射集中在这里，组件只负责取值和写回 */

import type {
  BossBarColor,
  BossBarNotch,
  ClickMode,
  DataMappingType,
  HudElementId,
  SkinType,
  ThemeMode,
  UIFont
} from "@/config/appConfig";
import { CONTAINER_STYLES } from "@/hud/inventory/styles";
import { iconStyleOptions } from "@/hud/statusbar/iconStyleOptions";
import { LANGUAGES, type LanguageCode, type MessageKey, type TFunction } from "@/i18n";
import type { Option } from "@/settings/components/controls";

function build<T extends string>(entries: { value: T; key: MessageKey }[], t: TFunction): Option<T>[] {
  return entries.map((entry) => ({ value: entry.value, label: t(entry.key) }));
}

const THEMES: { value: ThemeMode; key: MessageKey }[] = [
  { value: "system", key: "appearance.themeSystem" },
  { value: "dark", key: "appearance.themeDark" },
  { value: "light", key: "appearance.themeLight" }
];

const FONTS: { value: UIFont; key: MessageKey }[] = [
  { value: "system", key: "appearance.fontSystem" },
  { value: "yahei", key: "appearance.fontYahei" },
  { value: "unifont", key: "appearance.fontUnifont" },
  { value: "songti", key: "appearance.fontSongti" },
  { value: "kaiti", key: "appearance.fontKaiti" },
  { value: "heiti", key: "appearance.fontHeiti" }
];

const SKIN_TYPES: { value: SkinType; key: MessageKey }[] = [
  { value: "wide", key: "debug.skinTypeWide" },
  { value: "slim", key: "debug.skinTypeSlim" }
];

const CLICK_MODES: { value: ClickMode; key: MessageKey }[] = [
  { value: "single", key: "hud.clickSingle" },
  { value: "double", key: "hud.clickDouble" }
];

const DATA_MAPPINGS: { value: DataMappingType; key: MessageKey }[] = [
  { value: "battery", key: "data.battery" },
  { value: "memory", key: "data.memory" },
  { value: "cpu", key: "data.cpu" },
  { value: "gpu", key: "data.gpu" }
];

const BOSS_COLORS: { value: BossBarColor; key: MessageKey }[] = [
  { value: "blue", key: "color.blue" },
  { value: "green", key: "color.green" },
  { value: "pink", key: "color.pink" },
  { value: "purple", key: "color.purple" },
  { value: "red", key: "color.red" },
  { value: "white", key: "color.white" },
  { value: "yellow", key: "color.yellow" }
];

const BOSS_NOTCHES: { value: BossBarNotch | ""; key: MessageKey }[] = [
  { value: "", key: "bossBar.notchNone" },
  { value: "notched_6", key: "bossBar.notch6" },
  { value: "notched_10", key: "bossBar.notch10" },
  { value: "notched_12", key: "bossBar.notch12" },
  { value: "notched_20", key: "bossBar.notch20" }
];

export function languageOptions(): Option<LanguageCode>[] {
  return LANGUAGES.map(({ value, label }) => ({ value, label }));
}

export const themeOptions = (t: TFunction) => build(THEMES, t);
export const fontOptions = (t: TFunction) => build(FONTS, t);
export const skinTypeOptions = (t: TFunction) => build(SKIN_TYPES, t);
export const clickModeOptions = (t: TFunction) => build(CLICK_MODES, t);
export const dataMappingOptions = (t: TFunction) => build(DATA_MAPPINGS, t);
export const bossBarColorOptions = (t: TFunction) => build(BOSS_COLORS, t);
export const bossBarNotchOptions = (t: TFunction) => build(BOSS_NOTCHES, t);

export function inventoryStyleOptions(t: TFunction): Option[] {
  return CONTAINER_STYLES.map((style) => ({ value: style.file, label: t(style.nameKey) }));
}

export function elementIconStyleOptions(id: HudElementId, t: TFunction): Option[] | null {
  const styles = iconStyleOptions(id);
  if (!styles) return null;
  return styles.map((style) => ({ value: style.value, label: t(style.labelKey) }));
}
