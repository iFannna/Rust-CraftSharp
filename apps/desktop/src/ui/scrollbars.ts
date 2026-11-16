/** 自动隐藏滚动条：滚动或鼠标靠近右侧 24px 时淡入，移开后延时淡出 */

export {};

const HIDE_DELAY = 1200;
const FADE_OUT = 600;
const EDGE_ZONE = 24;

const hideTimers = new WeakMap<Element, number>();
const frames = new WeakMap<Element, number>();
const alphas = new WeakMap<Element, number>();
let hovered: Element | null = null;

function applyAlpha(element: Element, alpha: number) {
  alphas.set(element, alpha);
  (element as HTMLElement).style.setProperty("--scrollbar-alpha", alpha.toFixed(3));
}

/** 出现立即生效，避免滚动时滚动条慢半拍 */
function reveal(element: Element) {
  window.clearTimeout(hideTimers.get(element));
  hideTimers.delete(element);
  window.cancelAnimationFrame(frames.get(element) ?? 0);
  frames.delete(element);
  applyAlpha(element, 1);
}

function fadeOut(element: Element) {
  window.clearTimeout(hideTimers.get(element));
  hideTimers.delete(element);

  const from = alphas.get(element) ?? 0;
  window.cancelAnimationFrame(frames.get(element) ?? 0);
  if (from <= 0.001) {
    applyAlpha(element, 0);
    return;
  }

  const start = performance.now();
  const step = (now: number) => {
    if (!element.isConnected) {
      frames.delete(element);
      return;
    }
    const progress = Math.min(1, (now - start) / FADE_OUT);
    const eased = progress * progress * (3 - 2 * progress);
    applyAlpha(element, from * (1 - eased));
    if (progress < 1) frames.set(element, requestAnimationFrame(step));
    else frames.delete(element);
  };
  frames.set(element, requestAnimationFrame(step));
}

function scheduleHide(element: Element) {
  window.clearTimeout(hideTimers.get(element));
  hideTimers.set(
    element,
    window.setTimeout(() => fadeOut(element), HIDE_DELAY)
  );
}

function scrollerFrom(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(".ui-scroll-auto") : null;
}

function bind() {
  document.addEventListener(
    "pointermove",
    (event) => {
      const scroller = scrollerFrom(event.target);
      if (hovered && hovered !== scroller) {
        hovered.classList.remove("is-scroll-near");
        scheduleHide(hovered);
      }
      hovered = scroller;
      if (!scroller) return;

      const nearEdge = event.clientX >= scroller.getBoundingClientRect().right - EDGE_ZONE;
      scroller.classList.toggle("is-scroll-near", nearEdge);
      if (nearEdge) reveal(scroller);
      else scheduleHide(scroller);
    },
    { passive: true }
  );

  document.addEventListener(
    "wheel",
    (event) => {
      const scroller = scrollerFrom(event.target);
      if (!scroller) return;
      // 滚轮先于 scroll 事件到达，提前亮起避免慢半拍
      reveal(scroller);
      if (!scroller.classList.contains("is-scroll-near")) scheduleHide(scroller);
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.classList.contains("ui-scroll-auto")) return;
      reveal(target);
      // 鼠标停在滚动条旁时保持可见，只靠滚动触发才延时淡出
      if (!target.classList.contains("is-scroll-near")) scheduleHide(target);
    },
    true
  );

  const hideHovered = () => {
    if (hovered) {
      hovered.classList.remove("is-scroll-near");
      scheduleHide(hovered);
    }
    hovered = null;
  };
  document.documentElement.addEventListener("pointerleave", hideHovered);
  window.addEventListener("blur", hideHovered);
}

const marker = window as Window & { __craftsharpScrollbars?: boolean };
if (!marker.__craftsharpScrollbars) {
  marker.__craftsharpScrollbars = true;
  bind();
}
