/** 热键捕获：按 WPF 版规则生成 "Ctrl+Shift+Alt+Key" 形式的文本 */

export interface HotkeyCapture {
  /** 组合键文本；按键不受支持时为 null */
  text: string | null;
  hasModifier: boolean;
}

const CODE_NAMES: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  Delete: "Delete",
  Minus: "Minus",
  Equal: "Equal",
  BracketLeft: "BracketLeft",
  BracketRight: "BracketRight",
  Backslash: "Backslash",
  Semicolon: "Semicolon",
  Quote: "Quote",
  Comma: "Comma",
  Period: "Period",
  Slash: "Slash",
  Backquote: "Backquote",
  NumpadAdd: "NumPlus",
  NumpadSubtract: "NumMinus",
  NumpadMultiply: "NumMultiply",
  NumpadDivide: "NumDivide",
  NumpadDecimal: "NumDecimal",
  NumpadEnter: "NumEnter"
};

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "CapsLock",
  "NumLock",
  "ScrollLock"
]);

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

/** 比较两个组合是否相同：忽略大小写与多余空白 */
export function normalizeHotkey(text: string): string {
  return text
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join("+");
}

function mainKeyName(event: KeyboardEvent): string | null {
  const code = event.code;

  if (CODE_NAMES[code]) return CODE_NAMES[code];

  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];

  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];

  const numpad = /^Numpad([0-9])$/.exec(code);
  if (numpad) return `Num${numpad[1]}`;

  const fn = /^F([0-9]{1,2})$/.exec(code);
  if (fn) return code;

  // 无 code 的输入法或特殊键回退到 key，单字符统一大写
  if (event.key.length === 1) return event.key.toUpperCase();

  return null;
}

export function captureHotkey(event: KeyboardEvent): HotkeyCapture {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");

  const key = mainKeyName(event);
  if (!key) return { text: null, hasModifier: parts.length > 0 };

  parts.push(key);
  return { text: parts.join("+"), hasModifier: parts.length > 1 };
}
