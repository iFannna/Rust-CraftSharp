import { useRef, useState } from "react";
import { useI18n } from "@/i18n/useI18n";
import { captureHotkey, isModifierCode } from "@/settings/hotkey";

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

  // 捕获结束主动失焦，避免输入框残留捕获态
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

    // 单按修饰键继续等待主键
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
    <div className="hotkey-field">
      <div className="hotkey-line">
        <input
          ref={inputRef}
          type="text"
          readOnly
          className={["shortcut-input", recording ? "is-recording" : "", error ? "is-invalid" : ""]
            .filter(Boolean)
            .join(" ")}
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
        <button
          type="button"
          className="hotkey-clear"
          aria-label={t("hotkeys.clear")}
          title={t("hotkeys.clear")}
          disabled={!value}
          onClick={clear}
        >
          <span aria-hidden="true">{"\uE711"}</span>
        </button>
      </div>
      {error ? <span className="inline-error">{error}</span> : null}
    </div>
  );
}
