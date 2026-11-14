import { BOSS_BAR, type BossBarLayout, type BossBarRow } from "@/hud/bossbar/layout";
import { UNIFONT_FAMILY, ensureUnifont } from "@/hud/shared/font";
import { draw } from "@/hud/shared/canvas";
import { loadBossBarImages, type BossBarImages } from "@/hud/bossbar/assets";

export type BossBarRenderer = (layout: BossBarLayout) => void;

export async function createBossBarRenderer(canvas: HTMLCanvasElement): Promise<BossBarRenderer> {
  ensureUnifont();
  const images = await loadBossBarImages();
  await document.fonts.load(`${BOSS_BAR.nameFont * 6}px ${UNIFONT_FAMILY}`);

  return (layout) => drawBossBars(canvas, images, layout);
}

function drawBossBars(canvas: HTMLCanvasElement, images: BossBarImages, layout: BossBarLayout) {
  canvas.width = Math.max(1, Math.ceil(layout.width));
  canvas.height = Math.max(1, Math.ceil(layout.height));
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  for (const row of layout.rows) {
    drawName(ctx, row, layout.scale);
    drawBar(ctx, images, row, layout.scale);
  }
}

function drawName(ctx: CanvasRenderingContext2D, row: BossBarRow, scale: number) {
  if (!row.name) return;

  const fontSize = BOSS_BAR.nameFont * scale;
  const spacing = BOSS_BAR.charSpacing * scale;
  const shadow = 0.53 * scale;
  const characters = Array.from(row.name);

  ctx.font = `${fontSize}px "${UNIFONT_FAMILY}", monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const advances = characters.map((char) => ctx.measureText(char).width);
  const total = advances.reduce((sum, advance) => sum + advance + spacing, -spacing);
  let x = row.x + (row.width - total) / 2;

  characters.forEach((char, index) => {
    const left = Math.round(x);
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    ctx.fillText(char, left + shadow, row.nameY + shadow);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(char, left, row.nameY);
    x += advances[index] + spacing;
  });
}

function drawBar(ctx: CanvasRenderingContext2D, images: BossBarImages, row: BossBarRow, scale: number) {
  const textures = images.bars[row.config.color] ?? images.bars.blue;
  draw(ctx, textures.background, row.x, row.y, row.width, row.height);

  if (row.config.notch) {
    const notch = images.notches[row.config.notch];
    if (notch) draw(ctx, notch.background, row.x, row.y, row.width, row.height);
  }

  const filled = Math.round(row.width * row.percent);
  if (filled <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(row.x, row.y, filled, row.height);
  ctx.clip();

  draw(ctx, textures.progress, row.x, row.y, row.width, row.height);
  if (row.config.notch) {
    const notch = images.notches[row.config.notch];
    if (notch) draw(ctx, notch.progress, row.x, row.y, row.width, row.height);
  }

  ctx.restore();
}
