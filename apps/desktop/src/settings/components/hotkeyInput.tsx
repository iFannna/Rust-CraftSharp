import { useEffect, useRef, useState } from "react";
import { XIcon } from "@/ui/icons";
import { useI18n } from "@/i18n/useI18n";
import { setHotkeyRecording } from "@/lib/hotkeys";
import {
  MAX_HOTKEY_KEYS,
  keyFromEvent,
  sequenceText,
  type SequenceKey
} from "@/settings/hotkey";
import { confirmHotkeyConflict, confirmSimpleHotkey } from "@/settings/hotkeyDialogs";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip";
import { cn } from "@/ui/lib/utils";

/**
 * 只读输入框，聚焦后进入捕获状态
 * 按实际按下顺序记录，最多三键，失焦保存；Esc 取消、清空按钮删除
 */
export function HotkeyInput({
  value,
  onChange,
  label,
  allowSingle = false,
  distinguish = false,
  conflictLabel
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  /** 局部快捷键允许单键，如 Q / E */
  allowSingle?: boolean;
  /** 区分左右修饰键 */
  distinguish?: boolean;
  /** 返回占用该组合的项名称，没有冲突时为 null */
  conflictLabel?: (hotkey: string) => string | null;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  /** 弹窗期间阻止重复处理 */
  const busy = useRef(false);
  const skipCommit = useRef(false);
  const pressed = useRef(new Set<string>());
  const sequence = useRef<SequenceKey[]>([]);
  const previewRef = useRef("");
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState("");
  /** 确认弹窗期间保持显示刚录入的内容，取消才恢复旧值 */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => setHotkeyRecording(false), []);

  const updatePreview = (text: string) => {
    previewRef.current = text;
    setPreview(text);
  };

  const stopRecording = () => {
    setRecording(false);
    setError(null);
    setHotkeyRecording(false);
    pressed.current.clear();
    sequence.current = [];
  };

  const startRecording = () => {
    setError(null);
    setPending(null);
    skipCommit.current = false;
    pressed.current.clear();
    sequence.current = [];
    updatePreview("");
    setRecording(true);
    setHotkeyRecording(true);
  };

  const cancelRecording = () => {
    skipCommit.current = true;
    updatePreview("");
    stopRecording();
    setPending(null);
  };

  const clear = () => {
    updatePreview("");
    setPending(null);
    onChange("");
    setError(null);
  };

  /** 失焦落盘；确认期间保持显示新值，取消才恢复旧值 */
  const commit = async () => {
    const text = previewRef.current;
    if (!text) {
      stopRecording();
      return;
    }

    stopRecording();
    setPending(text);

    busy.current = true;
    let confirmed = true;
    try {
      if (text.split("+").length === 1 && !allowSingle) {
        confirmed = await confirmSimpleHotkey(t, text);
      }
      if (confirmed) {
        const occupied = conflictLabel?.(text) ?? null;
        if (occupied) {
          confirmed = await confirmHotkeyConflict(t, text, occupied);
        }
      }
    } finally {
      busy.current = false;
    }

    setPending(null);
    if (confirmed) onChange(text);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!recording) {
      // 键盘聚焦时用回车或空格开始录制，Tab 保持正常移动焦点
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        startRecording();
      }
      return;
    }

    if (busy.current) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape" || event.code === "Escape") {
      cancelRecording();
      inputRef.current?.blur();
      return;
    }

    // 按住不放的自动重复只算一次
    if (pressed.current.has(event.code)) return;
    pressed.current.add(event.code);

    if (pressed.current.size === 1) {
      sequence.current = [];
      setError(null);
    }

    if (sequence.current.length >= MAX_HOTKEY_KEYS) {
      setError(t("hotkeys.tooMany"));
      return;
    }

    const key = keyFromEvent(event.nativeEvent, distinguish);
    if (!key) {
      setError(t("hotkeys.unsupported"));
      return;
    }

    setError(null);
    sequence.current.push(key);
    updatePreview(sequenceText(sequence.current));
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!recording || busy.current) return;
    pressed.current.delete(event.code);
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
          value={recording ? preview : pending ?? value}
          placeholder={
            recording
              ? preview
                ? ""
                : t("hotkeys.press")
              : pending
                ? ""
                : t("common.notSet")
          }
          onPointerDown={() => {
            if (!recording) startRecording();
          }}
          onBlur={(event) => {
            if (!recording || busy.current) return;
            if (skipCommit.current) {
              skipCommit.current = false;
              stopRecording();
              return;
            }
            // 点击清空按钮不算离开录制，交给按钮自己的点击处理
            if (event.relatedTarget === clearRef.current) {
              stopRecording();
              return;
            }
            void commit();
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={clearRef}
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label={t("hotkeys.clear")}
              disabled={!value}
              onPointerDown={() => {
                skipCommit.current = true;
              }}
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
