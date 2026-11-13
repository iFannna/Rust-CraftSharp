import { HUD_ASSETS, loadImage } from "./assets";
import type { SlotIcon } from "./statusbar";

export async function loadMockSlotIcons(): Promise<Array<SlotIcon | null>> {
  const [heart, food, barrier] = await Promise.all([
    loadImage(HUD_ASSETS.heartFull),
    loadImage(HUD_ASSETS.foodFull),
    loadImage(HUD_ASSETS.barrier)
  ]);

  const icons: Array<SlotIcon | null> = Array(9).fill(null);
  icons[0] = { image: heart, smooth: true };
  icons[1] = { image: food, smooth: true };
  icons[2] = { image: barrier, smooth: false };
  return icons;
}
