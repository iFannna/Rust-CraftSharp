import type { CSSProperties } from "react";
import { useI18n } from "@/i18n/useI18n";
import { openDialogWindow } from "@/lib/dialogWindow";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import {
  AUTO_FILE_NAME_COLOR,
  DEFAULT_FILE_NAME_COLOR,
  FILE_NAME_COLOR_PRESETS,
  OTHER_FILE_NAME_COLOR,
  cssColorOf,
  isAutoColor,
  isHexColor,
  presetColorOf,
  rgbHexOf
} from "@/settings/fileNameColor";
import { Select, type Option } from "@/settings/components/controls";

/** 老下拉的色块是 16px、圆角 3、4px 棋盘格底 */
const CHECKER: CSSProperties = {
  backgroundImage: "repeating-conic-gradient(#cccccc 0% 25%, #ffffff 0% 50%)",
  backgroundSize: "8px 8px"
};

/** 老项目：自定义色排最前，然后 9 个预设，最后自动与其他... */
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
  const preset = presetColorOf(value);
  const custom = isHexColor(value) && !preset ? value.toUpperCase() : null;

  const options: Option<string>[] = [
    ...(custom ? [{ value: custom, label: rgbHexOf(custom) }] : []),
    ...FILE_NAME_COLOR_PRESETS.map((color) => ({ value: color, label: color })),
    { value: AUTO_FILE_NAME_COLOR, label: t("color.auto") },
    { value: OTHER_FILE_NAME_COLOR, label: t("color.other") }
  ];
  const choice = isAutoColor(value) ? AUTO_FILE_NAME_COLOR : (preset ?? custom ?? DEFAULT_FILE_NAME_COLOR);

  const pickCustom = async () => {
    const picked = await openDialogWindow<string>({
      label: WINDOW_LABEL.colorPicker,
      title: t("colorPicker.title"),
      page: "color-picker",
      params: { value: isHexColor(value) ? value : DEFAULT_FILE_NAME_COLOR },
      width: 360,
      height: 460,
      anchor: WINDOW_LABEL.settings
    });
    if (picked) onChange(picked.toUpperCase());
  };

  const handleSelect = (next: string) => {
    if (next === OTHER_FILE_NAME_COLOR) {
      void pickCustom();
      return;
    }
    onChange(isAutoColor(next) ? AUTO_FILE_NAME_COLOR : next.toUpperCase());
  };

  return (
    <Select
      value={choice}
      options={options}
      onChange={handleSelect}
      ariaLabel={label}
      renderLabel={(option) =>
        isHexColor(option.value) ? (
          <span className="flex items-center gap-2">
            <span
              className="h-4 w-4 flex-none overflow-hidden rounded-[3px] border border-black/10"
              style={CHECKER}
              aria-hidden="true"
            >
              <span className="block h-full w-full" style={{ backgroundColor: cssColorOf(option.value) }} />
            </span>
            <span className="tabular-nums">{rgbHexOf(option.value)}</span>
          </span>
        ) : (
          option.label
        )
      }
    />
  );
}
