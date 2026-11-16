import { useAppConfig } from "@/config/useAppConfig";
import { tOf, type LanguageCode, type TFunction } from "@/i18n";

/** 跟随配置里的界面语言，语言切换时随配置订阅一起重渲染 */
export function useI18n(): { t: TFunction; language: LanguageCode } {
  const { system } = useAppConfig();
  return { t: tOf(system.language), language: system.language };
}
