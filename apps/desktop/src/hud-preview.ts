import { loadMockSlotIcons } from "./hud/mockIcons";
import { createStatusBarRenderer, type StatusBarModel } from "./hud/statusbar";

const params = new URLSearchParams(location.search);
const forcedScale = Number(params.get("scale"));
const scale = Number.isFinite(forcedScale) && forcedScale > 0
  ? forcedScale
  : Math.max(1, (window.screen.width / 2560) * 6);

const model: StatusBarModel = {
  scale,
  health: 20,
  maxHealth: 20,
  food: 20,
  maxFood: 20,
  air: 20,
  maxAir: 20,
  armor: 20,
  maxArmor: 20,
  absorption: 20,
  maxAbsorption: 20,
  exp: 50,
  selectedSlot: -1
};

model.slotIcons = await loadMockSlotIcons();

const canvas = document.querySelector<HTMLCanvasElement>("#hud");

if (!canvas) {
  throw new Error("HUD canvas not found");
}

const render = await createStatusBarRenderer(canvas);
render(model);
document.body.dataset.ready = "true";

const tauriWindow = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

if (tauriWindow) {
  const { getCurrentWindow, LogicalPosition, LogicalSize } = await import("@tauri-apps/api/window");
  const currentWindow = getCurrentWindow();
  const width = canvas.width;
  const height = canvas.height;
  const screen = window.screen as Screen & { availTop?: number };
  const x = Math.round((screen.availWidth - width) / 2);
  const y = Math.round((screen.availTop ?? 0) + screen.availHeight - height);

  await currentWindow.setSize(new LogicalSize(width, height));
  await currentWindow.setPosition(new LogicalPosition(x, y));
}
