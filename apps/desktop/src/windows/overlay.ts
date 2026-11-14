import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getInventoryConfig } from "@/hud/inventory/config";

const params = new URLSearchParams(location.search);
const forcedOpacity = params.has("opacity") ? Number(params.get("opacity")) : NaN;
const config = getInventoryConfig();
const opacity = Number.isFinite(forcedOpacity) ? forcedOpacity : config.grayOverlayOpacity;

const shade = document.querySelector<HTMLElement>("#shade");
if (shade) {
  shade.style.background = `rgba(0, 0, 0, ${Math.max(0, Math.min(100, opacity)) / 100})`;
}

const tauriWindow = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

if (tauriWindow) {
  const currentWindow = getCurrentWindow();
  const width = window.screen.width;
  const height = window.screen.height;

  await currentWindow.setSize(new LogicalSize(width, height));
  await currentWindow.setPosition(new LogicalPosition(0, 0));
  await currentWindow.setIgnoreCursorEvents(true);
}
