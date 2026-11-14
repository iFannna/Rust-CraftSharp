import type { BossBarConfig } from "@/config/appConfig";

/**
 * BOSS 血条布局常量，单位是基准像素，绘制时整体乘缩放。
 * 行高 16/3 来自原版 WPF Unifont TextBlock 的实际行盒高度。
 */
export const BOSS_BAR = {
  barWidth: 182,
  barHeight: 5,
  nameFont: 8,
  nameMarginTop: 3,
  nameMarginBottom: 1,
  nameTextTop: 0.1,
  nameLine: 16 / 3,
  itemGap: 4,
  charSpacing: 1,
  shadowDepth: 0.75
} as const;

export interface BossBarRow {
  name: string;
  /** 名称文本 top 基线，字符逐个绘制 */
  nameY: number;
  /** 血条左上角与尺寸 */
  x: number;
  y: number;
  width: number;
  height: number;
  percent: number;
  config: BossBarConfig;
}

export interface BossBarLayout {
  scale: number;
  width: number;
  height: number;
  rows: BossBarRow[];
}

export function barRowPitch(): number {
  return BOSS_BAR.barHeight + BOSS_BAR.itemGap + BOSS_BAR.nameMarginTop + BOSS_BAR.nameMarginBottom + BOSS_BAR.nameLine;
}

export function firstBarTop(): number {
  return BOSS_BAR.nameMarginTop + BOSS_BAR.nameLine + BOSS_BAR.nameMarginBottom;
}

export function computeBossBarLayout(
  scale: number,
  bars: BossBarConfig[],
  percentOf: (bar: BossBarConfig) => number
): BossBarLayout {
  const rows: BossBarRow[] = [];
  const width = BOSS_BAR.barWidth * scale;
  const height = BOSS_BAR.barHeight * scale;
  const pitch = barRowPitch() * scale;
  const top = firstBarTop() * scale;

  bars.forEach((bar, index) => {
    rows.push({
      name: bar.name,
      nameY: (BOSS_BAR.nameTextTop + index * barRowPitch()) * scale,
      x: 0,
      y: top + index * pitch,
      width,
      height,
      percent: Math.max(0, Math.min(1, percentOf(bar))),
      config: bar
    });
  });

  return {
    scale,
    width,
    height: rows.length > 0 ? rows[rows.length - 1].y + height : 0,
    rows
  };
}
