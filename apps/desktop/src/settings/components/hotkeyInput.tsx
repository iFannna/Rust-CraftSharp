import { useEffect, useRef, useState } from "react";
import { XIcon } from "@/ui/icons";
import { useI18n } from "@/i18n/useI18n";
import { setHotkeyRecording } from "@/lib/hotkeys";
import { captureHotkey, isModifierCode } from "@/settings/hotkey";
import { confirmHotkeyConflict, confirmSimpleHotkey } from "@/settings/hotkeyDialogs";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip";
import { cn } from "@/ui/lib/utils";

/**
 * 只读输入框，聚焦后进入捕获状态
 * 录制期间全局热键暂停；Esc 取消、Backspace 清空
 */
export function HotkeyInput({
  value,
  onChange,
  label,
  allowSingle = false,
  conflictLabel
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  /** 局部快捷键允许单键，如 Q / E */
  allowSingle?: boolean;
  /** 返回占用该组合的项名称，没有冲突时为 null */
  conflictLabel?: (hotkey: string) => string | null;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  /** 弹窗期间阻止失焦结束录制，与老版临时摘掉失焦处理一致 */
  const busy = useRef(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => setHotkeyRecording(false), []);

  const stopRecording = () => {
    setRecording(false);
    setError(null);
    setHotkeyRecording(false);
  };

  const finishAndBlur = () => {
    stopRecording();
    inputRef.current?.blur();
  };

  const clear = () => {
    onChange("");
    setError(null);
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!recording || busy.current) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      finishAndBlur();
      return;
    }

    if (event.code === "Backspace") {
      clear();
      finishAndBlur();
      return;
    }

    if (isModifierCode(event.code)) return;

    const captured = captureHotkey(event.nativeEvent);
    if (!captured.text) {
      setError(t("hotkeys.unsupported"));
      return;
    }

    busy.current = true;
    try {
      if (!captured.hasModifier && !allowSingle && !(await confirmSimpleHotkey(t, captured.text))) {
        finishAndBlur();
        return;
      }
      const occupied = conflictLabel?.(captured.text) ?? null;
      if (occupied && !(await confirmHotkeyConflict(t, captured.text, occupied))) {
        finishAndBlur();
        return;
      }
    } finally {
      busy.current = false;
    }

    onChange(captured.text);
    finishAndBlur();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          type="text"
          readOnly
          className={cn(
            "h-9 w-[190px] max-w-full text-center",
            recording && "border-ring",
            error && "border-destructive focus-visible:ring-destructive"
          )}
          aria-label={label}
          value={recording ? "" : value}
          placeholder={
            recording
              ? t(allowSingle ? "hotkeys.pressKey" : "hotkeys.pressCombination")
              : t("common.notSet")
          }
          onFocus={() => {
            if (recording) return;
            setError(null);
            setRecording(true);
            setHotkeyRecording(true);
          }}
          onBlur={() => {
            if (!busy.current) stopRecording();
          }}
          onKeyDown={(event) => void handleKeyDown(event)}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label={t("hotkeys.clear")}
              disabled={!value}
              onClick={clear}
            >
              <XIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("hotkeys.clear")}</TooltipContent>
        </Tooltip>
      </div>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
