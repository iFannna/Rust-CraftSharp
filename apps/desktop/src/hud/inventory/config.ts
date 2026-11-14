/** 物品栏配置视图，统一走 appConfig，保留原调用接口 */

import { getConfig, subscribeConfig, updateConfig } from "@/config/appConfig";
import type { ClickMode, PositionConfig } from "@/config/appConfig";

export interface InventoryViewConfig {
  style: string;
  sharedData: boolean;
  clickMode: ClickMode;
  hoverEffect: boolean;
  showTooltip: boolean;
  grayOverlay: boolean;
  grayOverlayOpacity: number;
  lockPosition: boolean;
  rememberPosition: boolean;
  position: PositionConfig | null;
}

export function getInventoryConfig(): InventoryViewConfig {
  const inventory = getConfig().inventory;
  return {
    style: inventory.style,
    sharedData: inventory.sharedData,
    clickMode: inventory.clickMode,
    hoverEffect: inventory.hoverEffect,
    showTooltip: inventory.showTooltip,
    grayOverlay: inventory.grayOverlay,
    grayOverlayOpacity: inventory.grayOverlayOpacity,
    lockPosition: inventory.locked,
    rememberPosition: inventory.rememberPosition,
    position: inventory.position
  };
}

export function updateInventoryConfig(patch: Partial<InventoryViewConfig>) {
  const next: Parameters<typeof updateConfig>[0] = { inventory: {} };

  if (patch.style !== undefined) next.inventory!.style = patch.style;
  if (patch.sharedData !== undefined) next.inventory!.sharedData = patch.sharedData;
  if (patch.clickMode !== undefined) next.inventory!.clickMode = patch.clickMode;
  if (patch.hoverEffect !== undefined) next.inventory!.hoverEffect = patch.hoverEffect;
  if (patch.showTooltip !== undefined) next.inventory!.showTooltip = patch.showTooltip;
  if (patch.grayOverlay !== undefined) next.inventory!.grayOverlay = patch.grayOverlay;
  if (patch.grayOverlayOpacity !== undefined) next.inventory!.grayOverlayOpacity = patch.grayOverlayOpacity;
  if (patch.lockPosition !== undefined) next.inventory!.locked = patch.lockPosition;
  if (patch.rememberPosition !== undefined) next.inventory!.rememberPosition = patch.rememberPosition;
  if (patch.position !== undefined) next.inventory!.position = patch.position;

  updateConfig(next);
}

export function subscribeInventoryConfig(listener: () => void): () => void {
  return subscribeConfig(listener);
}
