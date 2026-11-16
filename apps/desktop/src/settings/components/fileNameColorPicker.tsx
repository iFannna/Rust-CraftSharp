import { useEffect, useState } from "react";
import type { MessageKey } from "@/i18n";
import { useI18n } from "@/i18n/useI18n";
import {
  AUTO_FILE_NAME_COLOR,
  FILE_NAME_COLOR_PRESETS,
  colorSelectValueOf,
  isHexColor,
  isPresetColor,
  toColorInputValue
} from "@/settings/fileNameColor";
import { Select } from "@/settings/components/controls";

const CHOICES: { value: string; labelKey: MessageKey }[] = [
  ...FILE_NAME_COLOR_PRESETS.map((preset) => ({ value: preset.value, labelKey: preset.labelKey })),
  { value: AUTO_FILE_NAME_COLOR, labelKey: "color.auto" },
  { value: "custom", labelKey: "color.custom" }
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
  const { t } = useI18n();
  const [customColor, setCustomColor] = useState(() => toColorInputValue(value));
  const choice = colorSelectValueOf(value);
  const options = CHOICES.map((option) => ({
    value: option.value,
    label: option.value.startsWith("#")
      ? `${t(option.labelKey)} ${option.value}`
      : t(option.labelKey)
  }));

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
      <Select value={choice} options={options} onChange={handleSelect} ariaLabel={label} />
      {choice === "custom" ? (
        <>
          <input
            type="color"
            className="color-picker"
            aria-label={t("aria.customColor", { label })}
            value={customColor}
            onChange={(event) => handleCustom(event.target.value)}
          />
          <span className="color-hex">{customColor.toUpperCase()}</span>
        </>
      ) : null}
    </div>
  );
}
