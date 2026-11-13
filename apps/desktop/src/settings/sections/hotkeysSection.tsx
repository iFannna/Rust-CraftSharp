import type { HotkeysConfig } from "../../config/appConfig";
import { defaultConfig, updateConfig } from "../../config/appConfig";
import { useAppConfig } from "../../config/useAppConfig";
import { Button, Card, Note, Row, SectionHead } from "../components/controls";
import { HotkeyInput } from "../components/hotkeyInput";

type HotkeyKey = "settings" | "statusBar" | "inventory" | "crosshair";

const HOTKEY_ITEMS: { key: HotkeyKey; label: string; description: string }[] = [
  { key: "settings", label: "打开设置", description: "显示或隐藏设置面板。" },
  { key: "statusBar", label: "显示状态栏", description: "显示或隐藏状态栏。" },
  { key: "inventory", label: "打开物品栏", description: "显示或隐藏物品栏。" },
  { key: "crosshair", label: "打开准星", description: "显示或隐藏准星。" }
];

export function HotkeysSection() {
  const config = useAppConfig();

  const updateHotkey = (key: HotkeyKey, hotkey: string) => {
    const patch: Partial<HotkeysConfig> = {};
    patch[key] = hotkey;
    updateConfig({ hotkeys: patch });
  };

  const resetHotkeys = () => {
    const defaults = defaultConfig().hotkeys;
    updateConfig({
      hotkeys: {
        settings: defaults.settings,
        statusBar: defaults.statusBar,
        inventory: defaults.inventory,
        crosshair: defaults.crosshair
      }
    });
  };

  return (
    <>
      <SectionHead title="热键" description="全局热键，必须在窗口外也能生效。" />
      <Card>
        {HOTKEY_ITEMS.map((item) => (
          <Row key={item.key} label={item.label} description={item.description}>
            <HotkeyInput
              value={config.hotkeys[item.key]}
              label={item.label}
              onChange={(hotkey) => updateHotkey(item.key, hotkey)}
            />
          </Row>
        ))}
        <div className="button-row">
          <Button onClick={resetHotkeys}>恢复默认热键</Button>
        </div>
      </Card>
      <Note>
        点击输入框后按下组合键即可捕获：必须包含至少一个修饰键（Ctrl / Alt / Shift），Esc 取消，Backspace
        清空。改动在重新注册后生效，前端会监听配置变化，无需重启应用。
      </Note>
    </>
  );
}
