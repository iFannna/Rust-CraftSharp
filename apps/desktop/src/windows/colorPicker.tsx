import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import ReactDOM from "react-dom/client";
import { getConfig } from "@/config/appConfig";
import { tOf } from "@/i18n";
import { emitDialogResult } from "@/lib/dialogWindow";
import { useRevealWindow } from "@/lib/windowReveal";
import { applyWindowTitle } from "@/lib/windowTitle";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import "@/ui/styles.css";

const params = new URLSearchParams(location.search);

const HUE_GRADIENT =
  "linear-gradient(to bottom, #FF0000 0%, #FFFF00 16.7%, #00FF00 33.3%, #00FFFF 50%, #0000FF 66.7%, #FF00FF 83.3%, #FF0000 100%)";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) {
    r1 = c;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
  } else if (h < 180) {
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  };
}

function rgbToHsv({ r, g, b }: Rgb): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function toHex6({ r, g, b }: Rgb): string {
  const part = (n: number) => n.toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

/** 老取色窗的初始色是红色，非法输入同样回退到红色 */
function parseInitial(raw: string | null): { rgb: Rgb; alpha: number } {
  const hex = (raw ?? "").replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return { rgb: hexToRgb(hex), alpha: 1 };
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    return { rgb: hexToRgb(hex.slice(2)), alpha: parseInt(hex.slice(0, 2), 16) / 255 };
  }
  return { rgb: { r: 255, g: 0, b: 0 }, alpha: 1 };
}

const INITIAL = parseInitial(params.get("value"));
const INITIAL_HSV = rgbToHsv(INITIAL.rgb);

function checkerStyle(size: number): CSSProperties {
  return {
    backgroundImage: "repeating-conic-gradient(#cccccc 0% 25%, #ffffff 0% 50%)",
    backgroundSize: `${size}px ${size}px`
  };
}

function rawByte(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : null;
}

function rawPercent(text: string): number | null {
  const trimmed = text.trim().replace(/%$/, "");
  return /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : null;
}

function dragProps(update: (clientX: number, clientY: number) => void) {
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      update(event.clientX, event.clientY);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      update(event.clientX, event.clientY);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };
}

function ColorPicker() {
  useRevealWindow();
  const t = tOf(getConfig().system.language);

  const spectrumRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const opacityRef = useRef<HTMLDivElement>(null);

  const [hue, setHue] = useState(INITIAL_HSV.h);
  const [saturation, setSaturation] = useState(INITIAL_HSV.s);
  const [brightness, setBrightness] = useState(INITIAL_HSV.v);
  const [opacity, setOpacity] = useState(INITIAL.alpha);

  const [hexText, setHexText] = useState(() => toHex6(INITIAL.rgb));
  const [rText, setRText] = useState(() => String(INITIAL.rgb.r));
  const [gText, setGText] = useState(() => String(INITIAL.rgb.g));
  const [bText, setBText] = useState(() => String(INITIAL.rgb.b));
  const [alphaText, setAlphaText] = useState(() => `${Math.round(INITIAL.alpha * 100)}%`);

  const rgb = hsvToRgb(hue, saturation, brightness);
  const alphaByte = Math.round(opacity * 255);
  const percentText = `${Math.round(opacity * 100)}%`;

  const cancel = () => emitDialogResult(WINDOW_LABEL.colorPicker, null);
  const confirm = () => {
    const hex = toHex6(rgb);
    const alphaHex = alphaByte.toString(16).padStart(2, "0");
    emitDialogResult(WINDOW_LABEL.colorPicker, `#${alphaHex}${hex.slice(1)}`.toUpperCase());
  };

  useEffect(() => {
    applyWindowTitle(t("colorPicker.title"));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const syncInputs = (nextRgb: Rgb, nextOpacity: number) => {
    setHexText(toHex6(nextRgb));
    setRText(String(nextRgb.r));
    setGText(String(nextRgb.g));
    setBText(String(nextRgb.b));
    setAlphaText(`${Math.round(nextOpacity * 100)}%`);
  };

  const applyHsv = (h: number, s: number, v: number, a: number) => {
    setHue(h);
    setSaturation(s);
    setBrightness(v);
    setOpacity(a);
    syncInputs(hsvToRgb(h, s, v), a);
  };

  const updateSpectrum = (clientX: number, clientY: number) => {
    const el = spectrumRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    applyHsv(
      hue,
      clamp((clientX - rect.left) / rect.width),
      clamp(1 - (clientY - rect.top) / rect.height),
      opacity
    );
  };

  const updateHue = (_clientX: number, clientY: number) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    applyHsv(clamp((clientY - rect.top) / rect.height) * 360, saturation, brightness, opacity);
  };

  const updateOpacity = (_clientX: number, clientY: number) => {
    const el = opacityRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = clamp((clientY - rect.top) / rect.height);
    setOpacity(next);
    setAlphaText(`${Math.round(next * 100)}%`);
  };

  const changeHex = (text: string) => {
    setHexText(text);
    const match = /^#?([0-9a-fA-F]{6})$/.exec(text.trim());
    if (!match) return;
    const nextRgb = hexToRgb(match[1]);
    const hsv = rgbToHsv(nextRgb);
    setHue(hsv.h);
    setSaturation(hsv.s);
    setBrightness(hsv.v);
    setRText(String(nextRgb.r));
    setGText(String(nextRgb.g));
    setBText(String(nextRgb.b));
  };

  const changeChannel = (channel: "r" | "g" | "b", text: string) => {
    if (channel === "r") setRText(text);
    else if (channel === "g") setGText(text);
    else setBText(text);

    const texts = { r: rText, g: gText, b: bText };
    texts[channel] = text;
    const raw = { r: rawByte(texts.r), g: rawByte(texts.g), b: rawByte(texts.b) };
    if (raw.r === null || raw.g === null || raw.b === null) return;

    const nextRgb = {
      r: Math.min(255, raw.r),
      g: Math.min(255, raw.g),
      b: Math.min(255, raw.b)
    };
    if (raw.r !== nextRgb.r) setRText(String(nextRgb.r));
    if (raw.g !== nextRgb.g) setGText(String(nextRgb.g));
    if (raw.b !== nextRgb.b) setBText(String(nextRgb.b));

    const hsv = rgbToHsv(nextRgb);
    setHue(hsv.h);
    setSaturation(hsv.s);
    setBrightness(hsv.v);
    setHexText(toHex6(nextRgb));
  };

  const changeAlpha = (text: string) => {
    setAlphaText(text);
    const raw = rawPercent(text);
    if (raw === null) return;
    setOpacity(Math.min(100, raw) / 100);
  };

  const pure = hsvToRgb(hue, 1, 1);
  const spectrumBackground = `linear-gradient(to right, rgba(${pure.r}, ${pure.g}, ${pure.b}, 0), rgb(${pure.r}, ${pure.g}, ${pure.b}))`;
  const opacityBackground = `linear-gradient(to bottom, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0), rgb(${rgb.r}, ${rgb.g}, ${rgb.b}))`;

  return (
    <ThemeRoot>
      <WindowFrame title={t("colorPicker.title")} controls="close" onClose={cancel}>
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
          <div className="flex h-[200px]">
            <div
              ref={spectrumRef}
              className="relative h-full min-w-0 flex-1 touch-none bg-white"
              {...dragProps(updateSpectrum)}
            >
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: spectrumBackground }}
              />
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: "linear-gradient(to bottom, transparent, #000)" }}
              />
              <span
                className="pointer-events-none absolute h-3 w-3 rounded-full border-2 border-white"
                style={{
                  left: `${saturation * 100}%`,
                  top: `${(1 - brightness) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.4)"
                }}
              />
            </div>
            <div
              ref={hueRef}
              className="relative ml-2 h-full w-6 flex-none touch-none overflow-hidden rounded-lg"
              {...dragProps(updateHue)}
            >
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: HUE_GRADIENT }}
              />
              <span
                className="pointer-events-none absolute left-0 right-0 h-1 rounded-sm border border-white"
                style={{
                  top: `${(hue / 360) * 100}%`,
                  transform: "translateY(-50%)",
                  boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.3)"
                }}
              />
            </div>
            <div
              ref={opacityRef}
              className="relative ml-2 h-full w-6 flex-none touch-none overflow-hidden rounded-lg"
              {...dragProps(updateOpacity)}
            >
              <div className="pointer-events-none absolute inset-0" style={checkerStyle(8)} />
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: opacityBackground }}
              />
              <span
                className="pointer-events-none absolute left-0 right-0 h-1 rounded-sm border border-neutral-400"
                style={{ top: `${opacity * 100}%`, transform: "translateY(-50%)" }}
              />
            </div>
          </div>

          <div className="relative h-10 overflow-hidden">
            <div className="absolute inset-0" style={checkerStyle(10)} />
            <div
              className="absolute inset-0"
              style={{ backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})` }}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="w-8 flex-none text-sm font-medium text-muted-foreground">HEX</span>
            <Input
              value={hexText}
              onChange={(event) => changeHex(event.target.value)}
              className="h-9 min-w-0 flex-1 font-medium"
              spellCheck={false}
              autoComplete="off"
              aria-label="HEX"
            />
            <Input
              value={alphaText}
              onChange={(event) => changeAlpha(event.target.value)}
              onBlur={() => setAlphaText(percentText)}
              className="h-9 w-[60px] flex-none text-center font-medium"
              spellCheck={false}
              autoComplete="off"
              aria-label="Alpha"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="w-8 flex-none text-sm font-medium text-muted-foreground">RGB</span>
            <Input
              value={rText}
              onChange={(event) => changeChannel("r", event.target.value)}
              className="h-9 min-w-0 flex-1 font-medium"
              spellCheck={false}
              autoComplete="off"
              aria-label="R"
            />
            <Input
              value={gText}
              onChange={(event) => changeChannel("g", event.target.value)}
              className="h-9 min-w-0 flex-1 font-medium"
              spellCheck={false}
              autoComplete="off"
              aria-label="G"
            />
            <Input
              value={bText}
              onChange={(event) => changeChannel("b", event.target.value)}
              className="h-9 min-w-0 flex-1 font-medium"
              spellCheck={false}
              autoComplete="off"
              aria-label="B"
            />
            <Input
              value={alphaText}
              onChange={(event) => changeAlpha(event.target.value)}
              onBlur={() => setAlphaText(percentText)}
              className="h-9 w-[60px] flex-none text-center font-medium"
              spellCheck={false}
              autoComplete="off"
              aria-label="Alpha"
            />
          </div>

          <div className="mt-auto flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancel}>
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={confirm}>
              {t("common.confirm")}
            </Button>
          </div>
        </div>
      </WindowFrame>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<ColorPicker />);
