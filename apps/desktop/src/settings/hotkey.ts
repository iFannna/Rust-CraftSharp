/** 热键序列：形如 "LCtrl+LShift+S"，最多三键，顺序即语义 */

export const MAX_HOTKEY_KEYS = 3;

export interface SequenceKey {
  /** 修饰键 Ctrl/Shift/Alt/Win，或其他键名 */
  base: string;
  side: "L" | "R" | null;
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
  NumpadEnter: "NumEnter",
  NumpadEqual: "NumEqual",
  NumpadComma: "NumComma",
  CapsLock: "CapsLock",
  NumLock: "NumLock",
  ScrollLock: "ScrollLock",
  PrintScreen: "PrintScreen",
  Pause: "Pause",
  ContextMenu: "ContextMenu",
  AudioVolumeMute: "VolumeMute",
  AudioVolumeDown: "VolumeDown",
  AudioVolumeUp: "VolumeUp",
  MediaPlayPause: "MediaPlayPause",
  MediaStop: "MediaStop",
  MediaTrackNext: "MediaTrackNext",
  MediaTrackPrevious: "MediaTrackPrevious",
  BrowserBack: "BrowserBack",
  BrowserForward: "BrowserForward",
  BrowserRefresh: "BrowserRefresh",
  BrowserStop: "BrowserStop",
  BrowserSearch: "BrowserSearch",
  BrowserFavorites: "BrowserFavorites",
  BrowserHome: "BrowserHome",
  LaunchMail: "LaunchMail",
  LaunchMediaPlayer: "LaunchMediaPlayer",
  LaunchApp1: "LaunchApp1",
  LaunchApp2: "LaunchApp2",
  IntlBackslash: "IntlBackslash",
  IntlRo: "IntlRo",
  IntlYen: "IntlYen",
  Convert: "Convert",
  NonConvert: "NonConvert",
  KanaMode: "KanaMode",
  Lang1: "Lang1",
  Lang2: "Lang2",
  Lang3: "Lang3",
  Lang4: "Lang4",
  Lang5: "Lang5",
  Help: "Help",
  Select: "Select",
  Clear: "Clear",
  Execute: "Execute",
  Sleep: "Sleep",
  Power: "Power",
  WakeUp: "WakeUp"
};

const MODIFIER_BASES: Record<string, string> = {
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  AltLeft: "Alt",
  AltRight: "Alt",
  MetaLeft: "Win",
  MetaRight: "Win",
  OSLeft: "Win",
  OSRight: "Win"
};

/** 主键名；修饰键返回 null */
export function mainKeyName(event: KeyboardEvent): string | null {
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

/** 事件对应的序列元素；区分左右时修饰键带侧别 */
export function keyFromEvent(event: KeyboardEvent, distinguish: boolean): SequenceKey | null {
  const base = MODIFIER_BASES[event.code];
  if (base) {
    if (!distinguish) return { base, side: null };
    return { base, side: event.code.endsWith("Left") ? "L" : "R" };
  }

  const key = mainKeyName(event);
  return key ? { base: key, side: null } : null;
}

export function keyText(key: SequenceKey): string {
  return key.side ? `${key.side}${key.base}` : key.base;
}

export function sequenceText(keys: SequenceKey[]): string {
  return keys.map(keyText).join("+");
}

function parseKey(part: string): SequenceKey {
  const match = /^(L|R)?(Ctrl|Shift|Alt|Win)$/i.exec(part);
  if (match) {
    return {
      base: MODIFIER_TEXT[match[2].toLowerCase()],
      side: match[1] ? (match[1].toUpperCase() as "L" | "R") : null
    };
  }
  return { base: part.toUpperCase(), side: null };
}

const MODIFIER_TEXT: Record<string, string> = {
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  win: "Win"
};

export function parseSequence(text: string): SequenceKey[] | null {
  const parts = text.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map(parseKey);
}

/** 序列是否命中绑定；绑定的修饰键没有侧别时任意一侧都算 */
export function hotkeysMatch(binding: string, captured: string): boolean {
  const target = parseSequence(binding);
  const actual = parseSequence(captured);
  if (!target || !actual || target.length !== actual.length) return false;
  return target.every((key, index) => {
    const item = actual[index];
    return key.base === item.base && (!key.side || key.side === item.side);
  });
}

/** 两个绑定是否会争抢同一次按键；逐位置比较，顺序不同不算冲突 */
export function hotkeysConflict(a: string, b: string): boolean {
  const target = parseSequence(a);
  const actual = parseSequence(b);
  if (!target || !actual || target.length !== actual.length) return false;
  return target.every((key, index) => {
    const item = actual[index];
    return key.base === item.base && (!key.side || !item.side || key.side === item.side);
  });
}

function stripSides(text: string): string {
  return text
    .split("+")
    .map((part) => {
      const match = /^([LR])(Ctrl|Shift|Alt|Win)$/i.exec(part.trim());
      return match ? match[2] : part;
    })
    .join("+");
}

/** 批量归并一组快捷键配置，关闭左右区分时使用 */
export function stripHotkeySides<T extends object>(hotkeys: T): T {
  return Object.fromEntries(
    Object.entries(hotkeys).map(([key, value]) => [key, stripSides(String(value))])
  ) as T;
}
