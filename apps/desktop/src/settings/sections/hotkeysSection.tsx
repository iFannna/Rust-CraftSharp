import { useEffect, useState } from "react";
import type { HotkeysConfig } from "@/config/appConfig";
import { defaultConfig, updateConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { Button, Card, Note, Row, SectionHead, SectionSubhead } from "@/settings/components/controls";
import { HotkeyInput } from "@/settings/components/hotkeyInput";

type HotkeyKey = "settings" | "statusBar" | "inventory" | "crosshair" | "dropItem" | "openInventory";

const FAILURE_KEY = "craftsharp.hotkeyFailures";

function readFailures(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAILURE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

const HOTKEY_ITEMS: { key: HotkeyKey; label: string; description: string; single?: boolean }[] = [
  { key: "settings", label: "打开设置面板", description: "显示或隐藏设置面板窗口" },
  { key: "statusBar", label: "打开状态栏", description: "显示或隐藏状态栏窗口" },
  { key: "inventory", label: "打开物品栏", description: "显示或隐藏物品栏窗口" },
  { key: "crosshair", label: "打开准星", description: "显示或隐藏准星窗口" },
  { key: "dropItem", label: "丢弃物品", description: "丢弃物品栏窗口中鼠标悬浮格子内的物品", single: true },
  { key: "openInventory", label: "打开物品栏", description: "显示/隐藏物品栏窗口，仅在应用窗口聚焦时生效", single: true }
];

export function HotkeysSection() {
  const config = useAppConfig();
  const [failed, setFailed] = useState<string[]>(readFailures);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === FAILURE_KEY) setFailed(readFailures());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
        crosshair: defaults.crosshair,
        dropItem: defaults.dropItem,
        openInventory: defaults.openInventory
      }
    });
  };

  return (
    <>
      <SectionHead title="快捷键设置" />
      {failed.length > 0 ? (
        <Note tone="warning">以下快捷键已被其他程序占用，注册失败：{failed.join("、")}</Note>
      ) : null}
      <SectionSubhead>全局快捷键</SectionSubhead>
      {HOTKEY_ITEMS.filter((item) => !item.single).map((item) => (
        <Row key={item.key} label={item.label} description={item.description}>
          <HotkeyInput
            value={config.hotkeys[item.key]}
            label={item.label}
            onChange={(hotkey) => updateHotkey(item.key, hotkey)}
          />
        </Row>
      ))}
      <SectionSubhead>局部快捷键</SectionSubhead>
      {HOTKEY_ITEMS.filter((item) => item.single).map((item) => (
        <Row key={item.key} label={item.label} description={item.description}>
          <HotkeyInput
            value={config.hotkeys[item.key]}
            label={item.label}
            allowSingle
            onChange={(hotkey) => updateHotkey(item.key, hotkey)}
          />
        </Row>
      ))}
      <Card className="action-card">
        <Button onClick={resetHotkeys}>恢复默认设置</Button>
      </Card>
      <Note>点击快捷键框后按下组合键，至少包含一个修饰键；Esc 取消，Backspace 清空。</Note>
    </>
  );
}
