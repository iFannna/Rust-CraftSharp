/** 把画布不透明区域整理成矩形发给 Rust，透明像素不接收鼠标 */

import { invoke } from "@tauri-apps/api/core";

const MIN_INTERVAL_MS = 80;
/** 忽略几乎透明的抗锯齿边缘，避免窗口形状带毛刺 */
const ALPHA_THRESHOLD = 8;

export interface MaskRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface OpenRect extends MaskRect {}

function collectRects(image: ImageData): MaskRect[] {
  const { width, height, data } = image;
  const open = new Map<string, OpenRect>();
  const rects: MaskRect[] = [];

  for (let y = 0; y < height; y += 1) {
    const seen = new Set<string>();
    let x = 0;

    while (x < width) {
      while (x < width && data[(y * width + x) * 4 + 3] < ALPHA_THRESHOLD) x += 1;
      if (x >= width) break;

      const start = x;
      while (x < width && data[(y * width + x) * 4 + 3] >= ALPHA_THRESHOLD) x += 1;
      const key = `${start}:${x - start}`;
      const previous = open.get(key);
      seen.add(key);

      if (previous && previous.y + previous.h === y) {
        previous.h += 1;
      } else {
        if (previous) {
          rects.push(previous);
          open.delete(key);
        }
        open.set(key, { x: start, y, w: x - start, h: 1 });
      }
    }

    for (const [key, rect] of open) {
      if (!seen.has(key)) {
        rects.push(rect);
        open.delete(key);
      }
    }
  }

  for (const rect of open.values()) rects.push(rect);
  return rects;
}

/**
 * 启动像素级命中区域，返回调度函数；重绘后调用一次即可。
 * full 为真时暂时恢复整窗区域，避免拖动中的图标被裁剪。
 * extraRects 用来把 DOM 覆盖层（文件名文本）一起算进窗口形状。
 */
export function createHitMask(
  canvas: HTMLCanvasElement,
  label: string,
  extraRects: () => MaskRect[] = () => []
): (full?: boolean, immediate?: boolean) => void {
  if (!("__TAURI_INTERNALS__" in window)) return () => undefined;

  let timer = 0;
  let publishing = false;
  let fullMode = false;
  let publishedFull = false;

  const publish = () => {
    timer = 0;
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) return;
    if (publishing) {
      // 上一轮还没回来，整窗模式必须补发，否则拖动时图标会被裁掉
      if (fullMode) timer = window.setTimeout(publish, 16);
      return;
    }
    publishing = true;

    const dpr = window.devicePixelRatio || 1;
    // 画布在窗口内贴底，命中区域要换算成窗口坐标
    const box = canvas.getBoundingClientRect();
    const baseX = Math.round(box.left);
    const baseY = Math.round(box.top);
    let rects: MaskRect[];

    if (fullMode) {
      rects = [{ x: baseX, y: baseY, w: canvas.width, h: canvas.height }];
    } else {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      rects = collectRects(image)
        .map((rect) => ({ ...rect, x: rect.x + baseX, y: rect.y + baseY }))
        .concat(extraRects());
    }

    const runs = rects.map((rect) => {
      const x = Math.floor(rect.x * dpr);
      const y = Math.floor(rect.y * dpr);
      const right = Math.ceil((rect.x + rect.w) * dpr);
      const bottom = Math.ceil((rect.y + rect.h) * dpr);
      return [x, y, right - x, bottom - y];
    });

    void invoke("set_hit_mask", { label, runs }).finally(() => {
      publishing = false;
    });
  };

  const schedule = (full = false, immediate = false) => {
    fullMode = full;
    if (full) {
      // 拖动期间每帧都会重绘，形状已经是整窗时不再重复提交
      if (publishedFull) return;
      publishedFull = true;
      // 拖动开始需要立即放开整窗区域，否则指针移出可见像素就收不到事件
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      if (publishing) {
        timer = window.setTimeout(publish, 16);
        return;
      }
      publish();
      return;
    }
    publishedFull = false;
    if (immediate) {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      publish();
      return;
    }
    if (timer) return;
    timer = window.setTimeout(publish, MIN_INTERVAL_MS);
  };

  schedule();
  return schedule;
}
