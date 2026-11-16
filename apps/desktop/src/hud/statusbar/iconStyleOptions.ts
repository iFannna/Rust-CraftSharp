/** 状态栏图标样式选项：纯文案与取值，不带任何贴图 */

import type { HudElementId } from "@/config/appConfig";
import type { MessageKey } from "@/i18n";

export interface IconStyleOption {
  value: string;
  labelKey: MessageKey;
}

const HEART_STYLES: IconStyleOption[] = [
  { value: "", labelKey: "iconStyle.heartNormal" },
  { value: "poisoned", labelKey: "iconStyle.heartPoisoned" },
  { value: "withered", labelKey: "iconStyle.heartWithered" },
  { value: "frozen", labelKey: "iconStyle.heartFrozen" },
  { value: "hardcore", labelKey: "iconStyle.heartHardcore" },
  { value: "vehicle", labelKey: "iconStyle.heartVehicle" }
];

const FOOD_STYLES: IconStyleOption[] = [
  { value: "", labelKey: "iconStyle.foodNormal" },
  { value: "hunger", labelKey: "iconStyle.foodHunger" }
];

const EXP_STYLES: IconStyleOption[] = [
  { value: "", labelKey: "iconStyle.expExperience" },
  { value: "jump", labelKey: "iconStyle.expJump" }
];

const ABSORBING_STYLES: IconStyleOption[] = [
  { value: "", labelKey: "iconStyle.absorbingNormal" },
  { value: "hardcore", labelKey: "iconStyle.absorbingHardcore" }
];

export function iconStyleOptions(id: HudElementId): IconStyleOption[] | null {
  if (id === "health") return HEART_STYLES;
  if (id === "food") return FOOD_STYLES;
  if (id === "absorbing") return ABSORBING_STYLES;
  if (id === "expBar") return EXP_STYLES;
  return null;
}
