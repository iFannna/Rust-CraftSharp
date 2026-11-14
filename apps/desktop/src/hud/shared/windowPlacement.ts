/** 窗口位置约束：换显示器或改分辨率后，把恢复的位置收回当前屏幕工作区 */

export interface ScreenPoint {
  x: number;
  y: number;
}

/** 完全在屏幕外返回 null，调用方回退到默认位置；部分越界则夹回工作区 */
export function clampToWorkArea(
  position: ScreenPoint,
  width: number,
  height: number
): ScreenPoint | null {
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  const left = screen.availLeft ?? 0;
  const top = screen.availTop ?? 0;
  const right = left + screen.availWidth;
  const bottom = top + screen.availHeight;

  const visible =
    position.x + width > left &&
    position.x < right &&
    position.y + height > top &&
    position.y < bottom;
  if (!visible) return null;

  return {
    x: Math.min(Math.max(position.x, left), Math.max(left, right - width)),
    y: Math.min(Math.max(position.y, top), Math.max(top, bottom - height))
  };
}
