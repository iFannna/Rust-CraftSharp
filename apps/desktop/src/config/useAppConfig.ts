import { useSyncExternalStore } from "react";
import { getConfig, subscribeConfig, type AppConfig } from "@/config/appConfig";

/** 订阅整份配置，设置面板与主界面共用 */
export function useAppConfig(): AppConfig {
  return useSyncExternalStore(subscribeConfig, getConfig, getConfig);
}
