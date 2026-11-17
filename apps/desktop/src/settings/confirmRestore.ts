import type { TFunction } from "@/i18n";
import { openDialogWindow } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";

/** 恢复默认设置前的二次确认，返回 true 表示用户确认 */
export async function confirmRestoreDefaults(t: TFunction): Promise<boolean> {
  const confirmed = await openDialogWindow<boolean>({
    label: WINDOW_LABEL.confirm,
    title: t("dialog.alertTitle"),
    page: "confirm",
    params: { kind: "confirm", text: t("common.restoreConfirmText") },
    width: 400,
    height: 190,
    anchor: WINDOW_LABEL.settings
  });
  return confirmed === true;
}
