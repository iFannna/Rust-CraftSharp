import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig, subscribeConfig, type BossBarConfig, type DataMappingType } from "@/config/appConfig";
import { computeBossBarLayout, type BossBarLayout } from "@/hud/bossbar/layout";
import { createBossBarRenderer } from "@/hud/bossbar/renderer";
import { installLocalHotkeys } from "@/lib/localHotkeys";

installLocalHotkeys();

interface SystemMetrics {
  battery: number;
  memory: number;
  cpu: number;
  gpu: number;
}

const params = new URLSearchParams(location.search);
const forcedScale = Number(params.get("scale"));
const scale = Number.isFinite(forcedScale) && forcedScale > 0
  ? forcedScale
  : Math.max(1, (window.screen.width / 2560) * 6);

// 浏览器预览用两组示例条，和黄金图场景一致
const PREVIEW_BARS: BossBarConfig[] = [
  {
    id: "boss_blue",
    name: "CraftSharp",
    color: "blue",
    notch: null,
    enabled: true,
    dataMappingEnabled: false,
    dataMappingType: "battery",
    customValueEnabled: true,
    currentValue: 50
  },
  {
    id: "boss_notch",
    name: "Notch",
    color: "red",
    notch: "notched_10",
    enabled: true,
    dataMappingEnabled: false,
    dataMappingType: "battery",
    customValueEnabled: true,
    currentValue: 70
  }
];

const canvas = document.querySelector<HTMLCanvasElement>("#bossbar");
if (!canvas) throw new Error("BOSS 血条画布缺失");

const renderer = await createBossBarRenderer(canvas);
const tauri = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
let metrics: SystemMetrics = { battery: 0, memory: 0, cpu: 0, gpu: 0 };

function activeBars(): BossBarConfig[] {
  if (!tauri) return params.get("empty") === "1" ? [] : PREVIEW_BARS;
  return getConfig().bossBars.filter((bar) => bar.enabled);
}

function percentOf(bar: BossBarConfig): number {
  if (bar.customValueEnabled) return bar.currentValue / 100;
  if (bar.dataMappingEnabled) return metrics[bar.dataMappingType as DataMappingType] ?? 0;
  return 1;
}

function render() {
  renderer(computeBossBarLayout(scale, activeBars(), percentOf));
}

render();
document.body.dataset.ready = "true";

if (tauri) {
  const currentWindow = getCurrentWindow();
  // 纯展示窗口，所有点击都穿到桌面
  await currentWindow.setIgnoreCursorEvents(true);
  let appliedWidth = 0;
  let appliedHeight = 0;
  let appliedX = Number.NaN;

  const syncWindow = async (layout: BossBarLayout) => {
    if (layout.width !== appliedWidth || layout.height !== appliedHeight) {
      await currentWindow.setSize(
        new LogicalSize(Math.max(1, Math.ceil(layout.width)), Math.max(1, Math.ceil(layout.height)))
      );
      appliedWidth = layout.width;
      appliedHeight = layout.height;
    }

    // 原版固定贴主屏顶部水平居中，不记忆位置
    const x = Math.round((window.screen.width - layout.width) / 2);
    if (x !== appliedX) {
      await currentWindow.setPosition(new LogicalPosition(x, 0));
      appliedX = x;
    }

    if (layout.rows.length > 0) {
      await currentWindow.show();
    } else {
      await currentWindow.hide();
    }
  };

  const refresh = async () => {
    const bars = getConfig().bossBars.filter((bar) => bar.enabled);
    metrics = { battery: 0, memory: 0, cpu: 0, gpu: 0 };
    if (bars.some((bar) => bar.dataMappingEnabled && !bar.customValueEnabled)) {
      metrics = await invoke<SystemMetrics>("system_metrics").catch(() => metrics);
    }
    const layout = computeBossBarLayout(scale, bars, percentOf);
    renderer(layout);
    await syncWindow(layout);
  };

  subscribeConfig(() => {
    void refresh();
  });

  // 数据映射每秒刷新一次，与原版 DispatcherTimer 一致
  window.setInterval(() => {
    if (!getConfig().bossBars.some((bar) => bar.enabled && bar.dataMappingEnabled && !bar.customValueEnabled)) return;
    void refresh();
  }, 1000);

  void refresh();
}
