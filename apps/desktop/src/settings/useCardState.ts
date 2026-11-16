import { useState } from "react";
import { updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";

/** 折叠卡片开合状态随“记住卡片状态”持久化；不记住时仍允许当前会话内展开 */
export function useCardState(key: string) {
  const config = useAppConfig();
  const system = config.system;
  const remembered = system.rememberCardStates;
  const stored = Boolean(system.cardExpandedStates[key]);
  const [expanded, setExpanded] = useState(stored);
  const open = remembered ? stored : expanded;

  return {
    open,
    onChange: (next: boolean) => {
      setExpanded(next);
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
