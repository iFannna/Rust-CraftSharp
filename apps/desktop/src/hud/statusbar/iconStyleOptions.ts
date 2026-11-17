/** 状态栏图标样式选项：纯文案与取值，不带任何贴图 */

import type { HudElementId } from "@/config/appConfig";
import type { MessageKey } from "@/i18n";

export interface IconStyleOption {
  value: string;
  labelKey: MessageKey;
}

const HEART_STYLES: IconStyleOption[] = [
  { value: "", labelKey: "iconStyle.heartNormal" },
  { value: "hardcore", labelKey: "iconStyle.heartHardcore" },
  { value: "poisoned", labelKey: "iconStyle.heartPoisoned" },
  { value: "poisoned_hardcore", labelKey: "iconStyle.heartPoisonedHardcore" },
  { value: "withered", labelKey: "iconStyle.heartWithered" },
  { value: "withered_hardcore", labelKey: "iconStyle.heartWitheredHardcore" },
  { value: "frozen", labelKey: "iconStyle.heartFrozen" },
  { value: "frozen_hardcore", labelKey: "iconStyle.heartFrozenHardcore" },
  { value: "vehicle", labelKey: "iconStyle.heartVehicle" },
  { value: "absorbing", labelKey: "iconStyle.heartAbsorbing" },
  { value: "absorbing_hardcore", labelKey: "iconStyle.heartAbsorbingHardcore" }
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

const ARMOR_STYLES: IconStyleOption[] = [{ value: "", labelKey: "iconStyle.armorNormal" }];

const AIR_STYLES: IconStyleOption[] = [{ value: "", labelKey: "iconStyle.airNormal" }];

export function iconStyleOptions(id: HudElementId): IconStyleOption[] | null {
  if (id === "health") return HEART_STYLES;
  if (id === "food") return FOOD_STYLES;
  if (id === "absorbing") return ABSORBING_STYLES;
  if (id === "armor") return ARMOR_STYLES;
  if (id === "air") return AIR_STYLES;
  if (id === "expBar") return EXP_STYLES;
  return null;
}
