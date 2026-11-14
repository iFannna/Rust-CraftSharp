import type { ReactNode } from "react";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { Accordion } from "@/settings/components/accordion";
import { Button, Card, SectionHead, SectionSubhead } from "@/settings/components/controls";
import { BossBarCardContent } from "@/settings/sections/hud/bossBarCard";
import { AttackIndicatorCardContent, CrosshairCardContent } from "@/settings/sections/hud/crosshairCard";
import { ElementCard } from "@/settings/sections/hud/elementCard";
import { HotbarCardContent } from "@/settings/sections/hud/hotbarCard";
import { StatusBarCardContent } from "@/settings/sections/hud/statusBarCard";
import { useCardState } from "@/settings/useCardState";

function HudCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const state = useCardState(id);
  return (
    <Accordion title={title} open={state.open} onOpenChange={state.onChange}>
      {children}
    </Accordion>
  );
}

export function HudSection() {
  return (
    <>
      <SectionHead title="HUD 设置" />
      <SectionSubhead>状态栏设置</SectionSubhead>
      <HudCard id="HudElement_StatusBar" title="状态栏">
        <StatusBarCardContent />
      </HudCard>
      <HudCard id="HudElement_Hotbar" title="快捷栏">
        <HotbarCardContent />
      </HudCard>
      <HudCard id="HudElement_Health" title="生命值">
        <ElementCard id="health" label="生命值" />
      </HudCard>
      <HudCard id="HudElement_Food" title="饥饿值">
        <ElementCard id="food" label="饥饿值" />
      </HudCard>
      <HudCard id="HudElement_Air" title="空气值">
        <ElementCard id="air" label="空气值" />
      </HudCard>
      <HudCard id="HudElement_Armor" title="护甲值">
        <ElementCard id="armor" label="护甲值" />
      </HudCard>
      <HudCard id="HudElement_Absorbing" title="伤害吸收">
        <ElementCard id="absorbing" label="伤害吸收" />
      </HudCard>
      <HudCard id="HudElement_ExpBar" title="经验条">
        <ElementCard id="expBar" label="经验条" />
      </HudCard>

      <SectionSubhead>准星设置</SectionSubhead>
      <HudCard id="HudElement_Crosshair" title="准星">
        <CrosshairCardContent />
      </HudCard>
      <HudCard id="HudElement_AttackIndicator" title="攻击指示器">
        <AttackIndicatorCardContent />
      </HudCard>

      <SectionSubhead>BOSS 血条设置</SectionSubhead>
      <HudCard id="HudElement_BossBar" title="BOSS 血条">
        <BossBarCardContent />
      </HudCard>

      <Card className="action-card">
        <Button onClick={() => updateConfig({ hudElements: defaultConfig().hudElements, hotbar: defaultConfig().hotbar })}>
          恢复默认设置
        </Button>
      </Card>
    </>
  );
}
