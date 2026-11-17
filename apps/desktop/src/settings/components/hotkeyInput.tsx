import { useRef, useState } from "react";
import { XIcon } from "@/ui/icons";
import { useI18n } from "@/i18n/useI18n";
import { captureHotkey, isModifierCode } from "@/settings/hotkey";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip";
import { cn } from "@/ui/lib/utils";

/** 只读输入框，聚焦后进入捕获状态：Esc 取消、Backspace 清空，可配置是否必须带修饰键 */
export function HotkeyInput({
  value,
  onChange,
  label,
  allowSingle = false
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  /** 本地快捷键允许单键，如 Q / E */
  allowSingle?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopRecording = () => {
    setRecording(false);
    setError(null);
  };

  const finishAndBlur = () => {
    stopRecording();
    inputRef.current?.blur();
  };

  const clear = () => {
    onChange("");
    setError(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!recording) return;
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

    if (!captured.hasModifier && !allowSingle) {
      setError(t("hotkeys.needModifier"));
      return;
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
            setRecording(true);
            setError(null);
          }}
          onBlur={stopRecording}
          onKeyDown={handleKeyDown}
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
