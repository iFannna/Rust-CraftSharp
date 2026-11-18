import type { ReactNode } from "react";
import type { InventoryConfig } from "@/config/appConfig";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { openDialogWindow } from "@/lib/dialogWindow";
import { setInventoryVisible } from "@/lib/windowControls";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { Accordion } from "@/settings/components/accordion";
import { confirmRestoreDefaults } from "@/settings/confirmRestore";
import {
  ActionBar,
  Button,
  Note,
  NumberField,
  Row,
  SectionHead,
  SectionSubhead,
  Select,
  Toggle
} from "@/settings/components/controls";
import { FileNameColorPicker } from "@/settings/components/fileNameColorPicker";
import { clickModeOptions, inventoryStyleOptions } from "@/settings/options";
import { useCardState } from "@/settings/useCardState";

function CardBlock({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const card = useCardState(id);
  return (
    <Accordion title={title} open={card.open} onOpenChange={card.onChange}>
      {children}
    </Accordion>
  );
}

function InventoryCardContent() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const inventory = config.inventory;
  const patch = (next: Partial<InventoryConfig>) => updateConfig({ inventory: next });
  const styleLabel =
    inventoryStyleOptions(t).find((option) => option.value === inventory.style)?.label ?? inventory.style;

  const openStylePreview = async () => {
    const picked = await openDialogWindow<string>({
      label: WINDOW_LABEL.stylePreview,
      title: t("inventory.stylePreviewTitle"),
      page: "style-preview",
      params: { value: inventory.style },
      width: 500,
      height: 400,
      anchor: WINDOW_LABEL.settings
    });
    if (!picked) return;
    patch({ style: picked });
  };

  return (
    <>
      <Row plain label={t("inventory.styleLabel")} description={t("inventory.styleDesc")}>
        <Button ariaLabel={t("aria.changeStyle")} onClick={() => void openStylePreview()}>
          {styleLabel}
        </Button>
      </Row>
      <Row plain label={t("hud.openAction")} description={t("hud.openActionDesc")}>
        <Select
          value={inventory.clickMode}
          options={clickModeOptions(t)}
          ariaLabel={t("aria.inventoryAction")}
          onChange={(clickMode) => patch({ clickMode })}
        />
      </Row>
      <Row plain label={t("inventory.show")} description={t("inventory.showDesc")}>
        <Toggle
          checked={inventory.visible}
          label={t("inventory.show")}
          onChange={(visible) => {
            // 窗口操作失败不影响配置写入，配置仍是唯一事实来源
            void setInventoryVisible(visible).catch(() => undefined);
          }}
        />
      </Row>
      <Row plain label={t("inventory.sharedData")} description={t("inventory.sharedDataDesc")}>
        <Toggle
          checked={inventory.sharedData}
          label={t("inventory.sharedData")}
          onChange={(sharedData) => patch({ sharedData })}
        />
      </Row>
      <Row plain label={t("inventory.locked")} description={t("inventory.lockedDesc")}>
        <Toggle
          checked={inventory.locked}
          label={t("inventory.locked")}
          onChange={(locked) => patch({ locked })}
        />
      </Row>
      <Row plain label={t("inventory.remember")} description={t("inventory.rememberDesc")}>
        <Toggle
          checked={inventory.rememberPosition}
          label={t("inventory.remember")}
          onChange={(rememberPosition) => patch({ rememberPosition })}
        />
      </Row>
      <Row plain label={t("inventory.hover")} description={t("inventory.hoverDesc")}>
        <Toggle
          checked={inventory.hoverEffect}
          label={t("inventory.hover")}
          onChange={(hoverEffect) => patch({ hoverEffect })}
        />
      </Row>
      <Row plain label={t("inventory.grayOverlay")} description={t("inventory.grayOverlayDesc")}>
        <Toggle
          checked={inventory.grayOverlay}
          label={t("inventory.grayOverlay")}
          onChange={(grayOverlay) => patch({ grayOverlay })}
        />
      </Row>
      {inventory.grayOverlay ? (
        <Row plain label={t("inventory.opacity")} description={t("inventory.opacityDesc")}>
          <div className="flex items-center gap-2">
            <NumberField
              value={inventory.grayOverlayOpacity}
              min={0}
              max={100}
              emptyValue={50}
              ariaLabel={t("aria.grayOpacity")}
              onChange={(grayOverlayOpacity) => patch({ grayOverlayOpacity })}
            />
            <span className="text-xs text-muted-foreground">{t("inventory.opacityMax")}</span>
          </div>
        </Row>
      ) : null}
      <Row plain label={t("inventory.hideStatusBar")} description={t("inventory.hideStatusBarDesc")}>
        <Toggle
          checked={inventory.hideStatusBar}
          label={t("inventory.hideStatusBar")}
          onChange={(hideStatusBar) => patch({ hideStatusBar })}
        />
      </Row>
    </>
  );
}

function TooltipCardContent() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const inventory = config.inventory;
  const patch = (next: Partial<InventoryConfig>) => updateConfig({ inventory: next });

  return (
    <>
      <Row plain label={t("hud.fileNameColor")} description={t("hud.fileNameColorDesc")}>
        <FileNameColorPicker
          value={inventory.fileNameColor}
          label={t("aria.inventoryFileNameColor")}
          onChange={(fileNameColor) => patch({ fileNameColor })}
        />
      </Row>
      <Row plain label={t("inventory.tooltip")} description={t("inventory.tooltipDesc")}>
        <Toggle
          checked={inventory.showTooltip}
          label={t("inventory.tooltip")}
          onChange={(showTooltip) => patch({ showTooltip })}
        />
      </Row>
      <Row plain label={t("inventory.tooltipFileName")} description={t("inventory.tooltipFileNameDesc")}>
        <Toggle
          checked={inventory.tooltipShowFileName}
          label={t("inventory.tooltipFileName")}
          onChange={(tooltipShowFileName) => patch({ tooltipShowFileName })}
        />
      </Row>
      <Row plain label={t("inventory.tooltipOriginalName")} description={t("inventory.tooltipOriginalNameDesc")}>
        <Toggle
          checked={inventory.tooltipShowOriginalName}
          label={t("inventory.tooltipOriginalName")}
          onChange={(tooltipShowOriginalName) => patch({ tooltipShowOriginalName })}
        />
      </Row>
      <Row plain label={t("inventory.tooltipFilePath")} description={t("inventory.tooltipFilePathDesc")}>
        <Toggle
          checked={inventory.tooltipShowFilePath}
          label={t("inventory.tooltipFilePath")}
          onChange={(tooltipShowFilePath) => patch({ tooltipShowFilePath })}
        />
      </Row>
      <Row plain label={t("inventory.tooltipFileType")} description={t("inventory.tooltipFileTypeDesc")}>
        <Toggle
          checked={inventory.tooltipShowFileType}
          label={t("inventory.tooltipFileType")}
          onChange={(tooltipShowFileType) => patch({ tooltipShowFileType })}
        />
      </Row>
    </>
  );
}

export function InventorySection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const empty = <Note>{t("inventory.emptyCard")}</Note>;

  const restoreDefaults = async () => {
    if (!(await confirmRestoreDefaults(t))) return;
    updateConfig({ inventory: defaultConfig().inventory });
  };

  return (
    <>
      <SectionHead title={t("inventory.title")} />

      <SectionSubhead>{t("inventory.section")}</SectionSubhead>
      <CardBlock id="InventoryTitle" title={t("inventory.card")}>
        <InventoryCardContent />
      </CardBlock>
      <CardBlock id="TooltipTitle" title={t("inventory.tooltip")}>
        <TooltipCardContent />
      </CardBlock>

      <SectionSubhead>{t("inventory.sectionPlayerInventory")}</SectionSubhead>
      <CardBlock id="SurvivalInventoryTitle" title={t("inventory.cardSurvival")}>
        {empty}
      </CardBlock>
      <CardBlock id="CreativeInventoryTitle" title={t("inventory.cardCreative")}>
        {empty}
      </CardBlock>

      <SectionSubhead>{t("inventory.sectionContainer")}</SectionSubhead>
      <CardBlock id="ChestTitle" title={t("inventory.cardChest")}>
        {empty}
      </CardBlock>
      <CardBlock id="LargeChestTitle" title={t("inventory.cardLargeChest")}>
        {empty}
      </CardBlock>

      <SectionSubhead>{t("inventory.sectionFunctionalBlock")}</SectionSubhead>
      <CardBlock id="CraftingTableTitle" title={t("inventory.cardCraftingTable")}>
        {empty}
      </CardBlock>
      <CardBlock id="EnchantmentTableTitle" title={t("inventory.cardEnchantingTable")}>
        {empty}
      </CardBlock>
      <CardBlock id="BeaconTitle" title={t("inventory.cardBeacon")}>
        {empty}
      </CardBlock>
      <CardBlock id="AnvilTitle" title={t("inventory.cardAnvil")}>
        {empty}
      </CardBlock>
      <CardBlock id="GrindstoneTitle" title={t("inventory.cardGrindstone")}>
        {empty}
      </CardBlock>
      <CardBlock id="CartographyTableTitle" title={t("inventory.cardCartographyTable")}>
        {empty}
      </CardBlock>
      <CardBlock id="StonecutterTitle" title={t("inventory.cardStonecutter")}>
        {empty}
      </CardBlock>
      <CardBlock id="LoomTitle" title={t("inventory.cardLoom")}>
        {empty}
      </CardBlock>
      <CardBlock id="SmithingTableTitle" title={t("inventory.cardSmithingTable")}>
        {empty}
      </CardBlock>

      <SectionSubhead>{t("inventory.sectionCreature")}</SectionSubhead>
      <CardBlock id="VillagerTitle" title={t("inventory.cardVillager")}>
        {empty}
      </CardBlock>
      <CardBlock id="HorseTitle" title={t("inventory.cardHorse")}>
        {empty}
      </CardBlock>
      <CardBlock id="DonkeyTitle" title={t("inventory.cardDonkey")}>
        {empty}
      </CardBlock>
      <CardBlock id="CamelTitle" title={t("inventory.cardCamel")}>
        {empty}
      </CardBlock>
      <CardBlock id="LlamaTitle" title={t("inventory.cardLlama")}>
        {empty}
      </CardBlock>
      <CardBlock id="NautilusTitle" title={t("inventory.cardNautilus")}>
        {empty}
      </CardBlock>

      <ActionBar>
        <Button onClick={() => void restoreDefaults()}>{t("common.restoreDefaults")}</Button>
      </ActionBar>
    </>
  );
}
