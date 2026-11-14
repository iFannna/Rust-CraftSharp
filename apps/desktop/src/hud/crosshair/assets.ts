import crosshairUrl from "@assets/minecraft/textures/gui/sprites/hud/crosshair/crosshair.png";
import attackBackgroundUrl from "@assets/minecraft/textures/gui/sprites/hud/crosshair/crosshair_attack_indicator_background.png";
import attackProgressUrl from "@assets/minecraft/textures/gui/sprites/hud/crosshair/crosshair_attack_indicator_progress.png";
import attackFullUrl from "@assets/minecraft/textures/gui/sprites/hud/crosshair/crosshair_attack_indicator_full.png";
import { loadImage } from "@/hud/statusbar/assets";
import { intrinsicSize } from "@/hud/shared/canvas";
import type { CrosshairTextures } from "@/hud/crosshair/layout";
import type { CrosshairImages } from "@/hud/crosshair/renderer";

export const CROSSHAIR_ASSETS = {
  crosshair: crosshairUrl,
  attackBackground: attackBackgroundUrl,
  attackProgress: attackProgressUrl,
  attackFull: attackFullUrl
} as const;

/** 同时返回原始像素尺寸，布局直接用纹理尺寸乘 scale */
export async function loadCrosshairAssets(): Promise<{
  images: CrosshairImages;
  textures: CrosshairTextures;
}> {
  const [crosshair, attackBackground, attackProgress, attackFull] = await Promise.all([
    loadImage(CROSSHAIR_ASSETS.crosshair),
    loadImage(CROSSHAIR_ASSETS.attackBackground),
    loadImage(CROSSHAIR_ASSETS.attackProgress),
    loadImage(CROSSHAIR_ASSETS.attackFull)
  ]);

  return {
    images: { crosshair, attackBackground, attackProgress, attackFull },
    textures: {
      crosshair: intrinsicSize(crosshair),
      background: intrinsicSize(attackBackground),
      progress: intrinsicSize(attackProgress),
      full: intrinsicSize(attackFull)
    }
  };
}
