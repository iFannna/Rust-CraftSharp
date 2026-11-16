/**
 * 轻量 i18n：每种语言一份静态文案，按语言缓存翻译函数。
 * 新增语言 = 在 LANGUAGES 里加一项 + 在 locales 下补一份同样键集的文案。
 */

import { enUS } from "./locales/en-US";
import { zhCN, type MessageKey, type Messages } from "./locales/zh-CN";

export type { MessageKey, Messages };

export const LANGUAGES = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" }
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["value"];

export type TFunction = (key: MessageKey, params?: Record<string, string | number>) => string;

const DICTIONARIES: Record<LanguageCode, Messages> = {
  "zh-CN": zhCN,
  "en-US": enUS
};

/** 插值只认 {name} 形式的占位符，文案里没有其他花括号用法 */
function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

const cache = new Map<LanguageCode, TFunction>();

export function tOf(language: LanguageCode): TFunction {
  let translate = cache.get(language);
  if (!translate) {
    const dictionary = DICTIONARIES[language] ?? zhCN;
    translate = (key, params) => interpolate(dictionary[key] ?? key, params);
    cache.set(language, translate);
  }
  return translate;
}

export function isLanguage(value: unknown): value is LanguageCode {
  return LANGUAGES.some((item) => item.value === value);
}
