import { updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";

/** 折叠卡片开合状态随“记住卡片状态”持久化 */
export function useCardState(key: string) {
  const config = useAppConfig();
  const system = config.system;
  const remembered = system.rememberCardStates;
  const open = remembered ? Boolean(system.cardExpandedStates[key]) : false;

  return {
    open,
    onChange: (next: boolean) => {
      if (!remembered) return;
      updateConfig({
        system: {
          ...system,
          cardExpandedStates: { ...system.cardExpandedStates, [key]: next }
        }
      });
    }
  };
}
