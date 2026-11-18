import type { ReactNode } from "react";
import type { HudElementId } from "@/config/appConfig";
import { useI18n } from "@/i18n/useI18n";
import { openDialogWindow } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { cn } from "@/ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip";

export type HudIconPickerElement =
  | HudElementId
  | "crosshair"
  | "attackIndicator"
  | "boss_bar"
  | "boss_bar_notch";

/** 打开 HUD 图标选择窗的图标按钮，外观与元素图标行一致 */
export function HudIconButton({
  element,
  value,
  topMost = false,
  className,
  tooltip,
  onPicked,
  children
}: {
  element: HudIconPickerElement;
  value: string;
  /** 从置顶的编辑弹窗打开时保持在上层 */
  topMost?: boolean;
  className?: string;
  /** 覆盖默认的「点击更换图标」提示 */
  tooltip?: string;
  onPicked?: (style: string) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();

  const open = async () => {
    const picked = await openDialogWindow<string>({
      label: WINDOW_LABEL.hudIconPicker,
      title: t("hudIconPicker.title"),
      page: "hud-icon-picker",
      params: { element, value },
      width: 480,
      height: 360,
      minWidth: 300,
      minHeight: 250,
      mode: "display",
      alwaysOnTop: topMost,
      anchor: WINDOW_LABEL.settings
    });
    if (picked === null) return;
    onPicked?.(picked);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "grid h-9 place-items-center rounded-sm px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
          aria-label={t("aria.changeElementIcon")}
          onClick={() => void open()}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? t("appearance.iconTooltip")}</TooltipContent>
    </Tooltip>
  );
}
