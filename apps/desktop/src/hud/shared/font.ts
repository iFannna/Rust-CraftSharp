import unifontUrl from "@assets/fonts/unifont-16.0.04.ttf";

export const UNIFONT_FAMILY = "CraftSharpUnifont";

let injected = false;

/** 按需注入 Unifont，多个覆盖层共用同一份声明 */
export function ensureUnifont(): void {
  if (injected) return;
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:"${UNIFONT_FAMILY}";src:url("${unifontUrl}") format("truetype");font-display:block;}`;
  document.head.append(style);
  injected = true;
}
