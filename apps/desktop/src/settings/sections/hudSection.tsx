import type { ReactNode } from "react";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { Accordion } from "@/settings/components/accordion";
import { ActionBar, Button, SectionHead, SectionSubhead } from "@/settings/components/controls";
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
  const config = useAppConfig();
  const t = tOf(config.system.language);

  return (
    <>
      <SectionHead title={t("hud.title")} />
      <SectionSubhead>{t("hud.statusBarSettings")}</SectionSubhead>
      <HudCard id="HudElement_StatusBar" title={t("hud.statusBar")}>
        <StatusBarCardContent />
      </HudCard>
      <HudCard id="HudElement_Hotbar" title={t("hud.hotbar")}>
        <HotbarCardContent />
      </HudCard>
      <HudCard id="HudElement_Health" title={t("hud.health")}>
        <ElementCard id="health" label={t("hud.health")} />
      </HudCard>
      <HudCard id="HudElement_Food" title={t("hud.food")}>
        <ElementCard id="food" label={t("hud.food")} />
      </HudCard>
      <HudCard id="HudElement_Air" title={t("hud.air")}>
        <ElementCard id="air" label={t("hud.air")} />
      </HudCard>
      <HudCard id="HudElement_Armor" title={t("hud.armor")}>
        <ElementCard id="armor" label={t("hud.armor")} />
      </HudCard>
      <HudCard id="HudElement_Absorbing" title={t("hud.absorbing")}>
        <ElementCard id="absorbing" label={t("hud.absorbing")} />
      </HudCard>
      <HudCard id="HudElement_ExpBar" title={t("hud.expBar")}>
        <ElementCard id="expBar" label={t("hud.expBar")} />
      </HudCard>

      <SectionSubhead>{t("hud.crosshairSettings")}</SectionSubhead>
      <HudCard id="HudElement_Crosshair" title={t("hud.crosshair")}>
        <CrosshairCardContent />
      </HudCard>
      <HudCard id="HudElement_AttackIndicator" title={t("hud.attackIndicator")}>
        <AttackIndicatorCardContent />
      </HudCard>

      <SectionSubhead>{t("hud.bossBarSettings")}</SectionSubhead>
      <HudCard id="HudElement_BossBar" title={t("hud.bossBar")}>
        <BossBarCardContent />
      </HudCard>

      <ActionBar>
        <Button onClick={() => updateConfig({ hudElements: defaultConfig().hudElements, hotbar: defaultConfig().hotbar })}>
          {t("common.restoreDefaults")}
        </Button>
      </ActionBar>
    </>
  );
}
