/** 快捷键录制中的确认弹窗：过于简单与内部冲突，均允许继续使用 */

import type { TFunction } from "@/i18n";
import { openDialogWindow } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";

async function confirm(t: TFunction, title: string, text: string): Promise<boolean> {
  const confirmed = await openDialogWindow<boolean>({
    label: WINDOW_LABEL.confirm,
    title,
    page: "confirm",
    params: { kind: "confirm", title, text },
    width: 400,
    height: 220,
    anchor: WINDOW_LABEL.settings
  });
  return confirmed === true;
}

export function confirmSimpleHotkey(t: TFunction, hotkey: string): Promise<boolean> {
  return confirm(t, t("hotkeys.simpleTitle"), t("hotkeys.simpleMessage", { hotkey }));
}

export function confirmHotkeyConflict(t: TFunction, hotkey: string, label: string): Promise<boolean> {
  const text = `${t("hotkeys.conflictMessage", { hotkey, label })}\n${t("hotkeys.conflictHint")}`;
  return confirm(t, t("hotkeys.conflictTitle"), text);
}
