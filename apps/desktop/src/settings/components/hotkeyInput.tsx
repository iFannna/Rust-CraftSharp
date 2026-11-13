import { useRef, useState } from "react";
import { captureHotkey, isModifierCode } from "../hotkey";

/** 只读输入框，聚焦后进入捕获状态：Esc 取消、Backspace 清空、必须有修饰键 */
export function HotkeyInput({
  value,
  onChange,
  label
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      finishAndBlur();
      return;
    }

    if (event.code === "Backspace") {
      onChange("");
      finishAndBlur();
      return;
    }

    // 单按修饰键继续等待主键
    if (isModifierCode(event.code)) return;

    const captured = captureHotkey(event.nativeEvent);
    if (!captured.text) {
      setError("该按键不支持，请换一个");
      return;
    }

    if (!captured.hasModifier) {
      setError("至少需要一个修饰键（Ctrl / Alt / Shift）");
      return;
    }

    onChange(captured.text);
    finishAndBlur();
  };

  return (
    <div className="hotkey-field">
      <input
        ref={inputRef}
        type="text"
        readOnly
        className={["shortcut-input", recording ? "is-recording" : "", error ? "is-invalid" : ""]
          .filter(Boolean)
          .join(" ")}
        aria-label={label}
        value={recording ? "" : value}
        placeholder={recording ? "请按下组合键…" : "未设置"}
        onFocus={() => {
          setRecording(true);
          setError(null);
        }}
        onBlur={stopRecording}
        onKeyDown={handleKeyDown}
      />
      {error ? <span className="inline-error">{error}</span> : null}
    </div>
  );
}
