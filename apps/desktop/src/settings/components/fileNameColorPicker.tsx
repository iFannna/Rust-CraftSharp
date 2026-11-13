import { useEffect, useState } from "react";
import {
  AUTO_FILE_NAME_COLOR,
  FILE_NAME_COLOR_PRESETS,
  colorSelectValueOf,
  isHexColor,
  isPresetColor,
  toColorInputValue
} from "../fileNameColor";
import { Select, type Option } from "./controls";

const CHOICES: Option[] = [
  ...FILE_NAME_COLOR_PRESETS.map((preset) => ({ value: preset.value, label: `${preset.label} ${preset.value}` })),
  { value: AUTO_FILE_NAME_COLOR, label: "自动（按文件名取色）" },
  { value: "custom", label: "自定义…" }
];

/** value 只存一个字段：auto、预设色或十六进制，自定义色记在组件内供再次编辑 */
export function FileNameColorPicker({
  value,
  onChange,
  label
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  const [customColor, setCustomColor] = useState(() => toColorInputValue(value));
  const choice = colorSelectValueOf(value);

  useEffect(() => {
    if (isHexColor(value) && !isPresetColor(value)) setCustomColor(toColorInputValue(value));
  }, [value]);

  const handleSelect = (next: string) => {
    if (next === "custom") {
      onChange(customColor.toUpperCase());
      return;
    }
    onChange(next === AUTO_FILE_NAME_COLOR ? AUTO_FILE_NAME_COLOR : next.toUpperCase());
  };

  const handleCustom = (next: string) => {
    setCustomColor(next);
    onChange(next.toUpperCase());
  };

  return (
    <div className="color-row">
      <span
        className="color-well"
        style={{ backgroundColor: isHexColor(value) ? value : "transparent" }}
        aria-hidden="true"
      />
      <Select value={choice} options={CHOICES} onChange={handleSelect} ariaLabel={label} />
      {choice === "custom" ? (
        <>
          <input
            type="color"
            className="color-picker"
            aria-label={`${label}自定义颜色`}
            value={customColor}
            onChange={(event) => handleCustom(event.target.value)}
          />
          <span className="color-hex">{customColor.toUpperCase()}</span>
        </>
      ) : null}
    </div>
  );
}
