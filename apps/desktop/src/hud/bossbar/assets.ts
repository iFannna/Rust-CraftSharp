import type { BossBarColor, BossBarNotch } from "@/config/appConfig";
import blueBackground from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/blue_background.png";
import blueProgress from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/blue_progress.png";
import greenBackground from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/green_background.png";
import greenProgress from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/green_progress.png";
import pinkBackground from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/pink_background.png";
import pinkProgress from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/pink_progress.png";
import purpleBackground from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/purple_background.png";
import purpleProgress from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/purple_progress.png";
import redBackground from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/red_background.png";
import redProgress from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/red_progress.png";
import whiteBackground from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/white_background.png";
import whiteProgress from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/white_progress.png";
import yellowBackground from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/yellow_background.png";
import yellowProgress from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/yellow_progress.png";
import notched6Background from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/notched_6_background.png";
import notched6Progress from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/notched_6_progress.png";
import notched10Background from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/notched_10_background.png";
import notched10Progress from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/notched_10_progress.png";
import notched12Background from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/notched_12_background.png";
import notched12Progress from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/notched_12_progress.png";
import notched20Background from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/notched_20_background.png";
import notched20Progress from "@assets/minecraft/textures/gui/sprites/hud/boss_bar/notched_20_progress.png";
import { loadImage } from "@/hud/statusbar/assets";

export interface BossBarTextures {
  background: HTMLImageElement;
  progress: HTMLImageElement;
}

export interface BossBarImages {
  bars: Record<BossBarColor, BossBarTextures>;
  notches: Record<BossBarNotch, BossBarTextures>;
}

const BAR_SOURCES: Record<BossBarColor, [string, string]> = {
  blue: [blueBackground, blueProgress],
  green: [greenBackground, greenProgress],
  pink: [pinkBackground, pinkProgress],
  purple: [purpleBackground, purpleProgress],
  red: [redBackground, redProgress],
  white: [whiteBackground, whiteProgress],
  yellow: [yellowBackground, yellowProgress]
};

const NOTCH_SOURCES: Record<BossBarNotch, [string, string]> = {
  notched_6: [notched6Background, notched6Progress],
  notched_10: [notched10Background, notched10Progress],
  notched_12: [notched12Background, notched12Progress],
  notched_20: [notched20Background, notched20Progress]
};

async function loadGroup<T extends string>(sources: Record<T, [string, string]>): Promise<Record<T, BossBarTextures>> {
  const entries = await Promise.all(
    (Object.entries(sources) as [T, [string, string]][]).map(async ([key, [background, progress]]) => {
      const [backgroundImage, progressImage] = await Promise.all([loadImage(background), loadImage(progress)]);
      return [key, { background: backgroundImage, progress: progressImage }] as const;
    })
  );

  return Object.fromEntries(entries) as Record<T, BossBarTextures>;
}

export async function loadBossBarImages(): Promise<BossBarImages> {
  const [bars, notches] = await Promise.all([loadGroup(BAR_SOURCES), loadGroup(NOTCH_SOURCES)]);
  return { bars, notches };
}
