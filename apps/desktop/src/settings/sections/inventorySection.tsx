import type { InventoryConfig } from "@/config/appConfig";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { setInventoryVisible } from "@/lib/windowControls";
import { Accordion } from "@/settings/components/accordion";
import {
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

export function InventorySection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const inventory = config.inventory;
  const card = useCardState("InventoryTitle");

  const patch = (next: Partial<InventoryConfig>) => updateConfig({ inventory: next });

  return (
    <>
      <SectionHead title={t("inventory.title")} />
      <SectionSubhead>{t("inventory.section")}</SectionSubhead>
      <Accordion title={t("inventory.card")} open={card.open} onOpenChange={card.onChange}>
        <Row plain label={t("inventory.styleLabel")} description={t("inventory.styleDesc")}>
          <Select
            value={inventory.style}
            options={inventoryStyleOptions(t)}
            ariaLabel={t("aria.style")}
            onChange={(style) => patch({ style })}
          />
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
        <Row
          plain
          label={t("inventory.opacity")}
          description={t("inventory.opacityDesc")}
          disabled={!inventory.grayOverlay}
        >
          <div className="inline-value">
            <NumberField
              value={inventory.grayOverlayOpacity}
              min={0}
              max={100}
              ariaLabel={t("aria.grayOpacity")}
              disabled={!inventory.grayOverlay}
              onChange={(grayOverlayOpacity) => patch({ grayOverlayOpacity })}
            />
            <span className="inline-suffix">{t("inventory.opacityMax")}</span>
          </div>
        </Row>
        <Row plain label={t("inventory.hideStatusBar")} description={t("inventory.hideStatusBarDesc")}>
          <Toggle
            checked={inventory.hideStatusBar}
            label={t("inventory.hideStatusBar")}
            onChange={(hideStatusBar) => patch({ hideStatusBar })}
          />
        </Row>
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
        <Row
          plain
          label={t("inventory.tooltipFileName")}
          description={t("inventory.tooltipFileNameDesc")}
          disabled={!inventory.showTooltip}
        >
          <Toggle
            checked={inventory.tooltipShowFileName}
            label={t("inventory.tooltipFileName")}
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowFileName) => patch({ tooltipShowFileName })}
          />
        </Row>
        <Row
          plain
          label={t("inventory.tooltipOriginalName")}
          description={t("inventory.tooltipOriginalNameDesc")}
          disabled={!inventory.showTooltip}
        >
          <Toggle
            checked={inventory.tooltipShowOriginalName}
            label={t("inventory.tooltipOriginalName")}
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowOriginalName) => patch({ tooltipShowOriginalName })}
          />
        </Row>
        <Row
          plain
          label={t("inventory.tooltipFilePath")}
          description={t("inventory.tooltipFilePathDesc")}
          disabled={!inventory.showTooltip}
        >
          <Toggle
            checked={inventory.tooltipShowFilePath}
            label={t("inventory.tooltipFilePath")}
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowFilePath) => patch({ tooltipShowFilePath })}
          />
        </Row>
        <Row
          plain
          label={t("inventory.tooltipFileType")}
          description={t("inventory.tooltipFileTypeDesc")}
          disabled={!inventory.showTooltip}
        >
          <Toggle
            checked={inventory.tooltipShowFileType}
            label={t("inventory.tooltipFileType")}
            disabled={!inventory.showTooltip}
            onChange={(tooltipShowFileType) => patch({ tooltipShowFileType })}
          />
        </Row>
        <Note>{t("inventory.note")}</Note>
        <div className="action-card">
          <Button onClick={() => updateConfig({ inventory: defaultConfig().inventory })}>
            {t("common.restoreDefaults")}
          </Button>
        </div>
      </Accordion>
    </>
  );
}
