import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { getConfig, subscribeConfig, type DataMappingType } from "@/config/appConfig";
import { loadCrosshairAssets } from "@/hud/crosshair/assets";
import { computeCrosshairLayout, resolveScale } from "@/hud/crosshair/layout";
import { drawCrosshairLayer } from "@/hud/crosshair/renderer";
import { installLocalHotkeys } from "@/lib/localHotkeys";

installLocalHotkeys();

declare global {
  interface Window {
    /** 供外部设置攻击指示器进度，0-1 */
    setAttackIndicatorPercent?: (percent: number) => void;
  }
}

const params = new URLSearchParams(location.search);
const scale = resolveScale(window.screen.width, params.has("scale") ? Number(params.get("scale")) : undefined);

const canvasNode = document.querySelector<HTMLCanvasElement>("#crosshair");
if (!canvasNode) throw new Error("准星画布缺失");
const canvas: HTMLCanvasElement = canvasNode;

const { images, textures } = await loadCrosshairAssets();
const layout = computeCrosshairLayout(scale, window.screen.width, window.screen.height, textures);

// URL 参数只用于单独预览，正式显隐读统一配置
function flagOverride(name: string): boolean | null {
  const value = params.get(name);
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

const crosshairOverride = flagOverride("crosshair");
const attackIndicatorOverride = flagOverride("attackIndicator");

const forcedPercent = params.has("attack") ? Number(params.get("attack")) : NaN;
let metrics: Record<DataMappingType, number> = { battery: 0, memory: 0, cpu: 0, gpu: 0 };

function configuredPercent(): number {
  const indicator = getConfig().hudElements.attackIndicator;
  if (indicator.customValueEnabled) return clampPercent(indicator.currentValue / 100);
  if (indicator.dataMappingEnabled) return clampPercent(metrics[indicator.dataMappingType] ?? 0);
  return 1;
}

let percent = Number.isFinite(forcedPercent) ? clampPercent(forcedPercent) : configuredPercent();

function clampPercent(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function render() {
  const hud = getConfig().hudElements;
  drawCrosshairLayer(canvas, {
    layout,
    images,
    crosshairVisible: crosshairOverride ?? hud.crosshairVisible,
    attackIndicatorVisible: attackIndicatorOverride ?? hud.attackIndicatorVisible,
    percent
  });
}

function setAttackIndicatorPercent(next: number) {
  if (!Number.isFinite(next)) return;
  percent = clampPercent(next);
  render();
}

window.setAttackIndicatorPercent = setAttackIndicatorPercent;

subscribeConfig(() => {
  if (!Number.isFinite(forcedPercent)) percent = configuredPercent();
  render();
});
render();
document.body.dataset.ready = "true";

const tauriWindow = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

if (tauriWindow) {
  // 整屏准星窗口必须鼠标穿透，否则会挡住下层游戏与桌面操作
  const currentWindow = getCurrentWindow();
  await currentWindow.setSize(new LogicalSize(layout.width, layout.height));
  await currentWindow.setPosition(new LogicalPosition(0, 0));
  await currentWindow.setIgnoreCursorEvents(true);

  const refreshIndicator = async () => {
    const indicator = getConfig().hudElements.attackIndicator;
    if (indicator.dataMappingEnabled && !indicator.customValueEnabled) {
      metrics = await invoke<typeof metrics>("system_metrics").catch(() => metrics);
      if (!Number.isFinite(forcedPercent)) percent = configuredPercent();
      render();
    }
  };
  window.setInterval(() => void refreshIndicator(), 1000);
  void refreshIndicator();

  // 先按屏幕尺寸铺满再显示，避免 800×600 的初始窗口闪一下
  await currentWindow.setAlwaysOnTop(getConfig().hudElements.crosshairTopMost);
  if (getConfig().hudElements.crosshairVisible) {
    await currentWindow.show();
  }
}
