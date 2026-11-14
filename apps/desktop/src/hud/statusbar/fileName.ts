import { ensureUnifont, UNIFONT_FAMILY } from "@/hud/shared/font";
import { autoFileNameColor } from "@/hud/slots/store";

const SHOW_DURATION_MS = 2000;
const FADE_DURATION_MS = 500;

function darken(hex: string): string {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 8 ? normalized.slice(2) : normalized;
  if (value.length !== 6) return "rgba(0,0,0,1)";

  const r = Math.round(parseInt(value.slice(0, 2), 16) * 0.5);
  const g = Math.round(parseInt(value.slice(2, 4), 16) * 0.5);
  const b = Math.round(parseInt(value.slice(4, 6), 16) * 0.5);
  return `rgb(${r}, ${g}, ${b})`;
}

function resolveColor(colorSetting: string, fileName: string): string {
  if (colorSetting === "auto") return autoFileNameColor(fileName);
  return colorSetting;
}

export class FileNameOverlay {
  private timer = 0;
  private fadeTimer = 0;

  constructor(
    private readonly element: HTMLElement,
    private readonly scale: number,
    private colorSetting: string
  ) {
    ensureUnifont();
    const depth = 0.75 * scale;
    Object.assign(element.style, {
      position: "fixed",
      left: "0",
      right: "0",
      bottom: `${50 * scale}px`,
      textAlign: "center",
      pointerEvents: "none",
      fontFamily: `"${UNIFONT_FAMILY}", monospace`,
      fontSize: `${8 * scale}px`,
      lineHeight: "1",
      opacity: "1",
      visibility: "hidden",
      whiteSpace: "nowrap"
    });
    element.style.setProperty("--shadow-depth", `${depth}px`);
  }

  /** 设置面板切换文件名颜色后即时生效 */
  setColorSetting(colorSetting: string): void {
    this.colorSetting = colorSetting;
  }

  show(fileName: string): void {
    if (!fileName) {
      this.hideImmediately();
      return;
    }

    window.clearTimeout(this.timer);
    window.clearTimeout(this.fadeTimer);

    const color = resolveColor(this.colorSetting, fileName);
    this.element.textContent = fileName;
    this.element.style.color = color;
    this.element.style.textShadow = `${0.53 * this.scale}px ${0.53 * this.scale}px 0 ${darken(color)}`;
    this.element.style.transition = "none";
    this.element.style.opacity = "1";
    this.element.style.visibility = "visible";

    this.timer = window.setTimeout(() => this.hide(), SHOW_DURATION_MS);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.fadeTimer);

    this.element.style.transition = `opacity ${FADE_DURATION_MS}ms linear`;
    this.element.style.opacity = "0";

    this.fadeTimer = window.setTimeout(() => {
      if (Number.parseFloat(this.element.style.opacity || "1") <= 0.01) {
        this.element.style.visibility = "hidden";
        this.element.textContent = "";
        this.element.style.opacity = "1";
      }
    }, FADE_DURATION_MS);
  }

  hideImmediately(): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.fadeTimer);

    this.element.style.transition = "none";
    this.element.style.visibility = "hidden";
    this.element.textContent = "";
    this.element.style.opacity = "1";
  }
}
