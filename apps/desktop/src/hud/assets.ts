import hotbarUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/hotbar/hotbar.png";
import hotbarOffhandUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/hotbar/hotbar_offhand.png";
import hotbarSelectionUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/hotbar/hotbar_selection.png";
import heartContainerUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/heart/container.png";
import heartFullUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/heart/full.png";
import heartHalfUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/heart/half.png";
import absorbingFullUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/heart/absorbing_full.png";
import absorbingHalfUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/heart/absorbing_half.png";
import foodEmptyUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/food/food_empty.png";
import foodFullUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/food/food_full.png";
import foodHalfUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/food/food_half.png";
import airUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/air/air.png";
import airEmptyUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/air/air_empty.png";
import armorEmptyUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/armor/armor_empty.png";
import armorFullUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/armor/armor_full.png";
import armorHalfUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/armor/armor_half.png";
import expBackgroundUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/experience_bar/experience_bar_background.png";
import expProgressUrl from "../../../../assets/minecraft/textures/gui/sprites/hud/experience_bar/experience_bar_progress.png";
import barrierUrl from "../../../../assets/minecraft/textures/item/item/barrier.png";

export const HUD_ASSETS = {
  hotbar: hotbarUrl,
  hotbarOffhand: hotbarOffhandUrl,
  hotbarSelection: hotbarSelectionUrl,
  heartContainer: heartContainerUrl,
  heartFull: heartFullUrl,
  heartHalf: heartHalfUrl,
  absorbingFull: absorbingFullUrl,
  absorbingHalf: absorbingHalfUrl,
  foodEmpty: foodEmptyUrl,
  foodFull: foodFullUrl,
  foodHalf: foodHalfUrl,
  air: airUrl,
  airEmpty: airEmptyUrl,
  armorEmpty: armorEmptyUrl,
  armorFull: armorFullUrl,
  armorHalf: armorHalfUrl,
  expBackground: expBackgroundUrl,
  expProgress: expProgressUrl,
  barrier: barrierUrl
} as const;

export type HudImageKey = keyof typeof HUD_ASSETS;
export type HudImages = Record<HudImageKey, HTMLImageElement>;

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;

  if (!image.complete) {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`无法加载资源: ${src}`));
    });
  }

  return image;
}

export async function loadHudImages(): Promise<HudImages> {
  const entries = await Promise.all(
    (Object.entries(HUD_ASSETS) as [HudImageKey, string][]).map(async ([key, src]) => {
      const image = await loadImage(src);
      return [key, image] as const;
    })
  );

  return Object.fromEntries(entries) as HudImages;
}
