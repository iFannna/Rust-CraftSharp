import { useCallback, useEffect, useRef, useState } from "react";
import { FileNameOverlay } from "./hud/fileNameOverlay";
import { HotbarInteraction, type HotbarHost } from "./hud/hotbarInteraction";
import { isPathMissing, loadSlotIcon } from "./hud/iconService";
import { computeLayout, type OffhandConfig } from "./hud/layout";
import {
  copyItemPath,
  copySlot,
  cutSlot,
  deleteSlotContent,
  getClipboard,
  openItem,
  pasteInto,
  renameItem,
  revealItem,
  runItemAsAdmin,
  subscribeClipboard
} from "./hud/slotActions";
import { showSlotMenu, type MenuItemSpec } from "./hud/slotMenu";
import {
  clearSlot,
  displayNameOf,
  getSlotItem,
  setSlot,
  slotIdForGlobal,
  subscribeSlots,
  swapSlots
} from "./hud/slotStore";
import { createStatusBarRenderer, type SlotIcon, type StatusBarModel } from "./hud/statusbar";

const SAMPLE_SLOTS = [
  "C:\\Windows\\System32\\notepad.exe",
  "C:\\Windows",
  "C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg",
  "C:\\Windows\\System32\\shell32.dll",
  "Z:\\craftsharp-missing\\file.txt"
];

const EXECUTABLE_EXTENSIONS = [".exe", ".bat", ".cmd", ".msi", ".ps1", ".vbs"];

function isExecutable(path: string): boolean {
  const lower = path.toLowerCase();
  return EXECUTABLE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

interface Stats {
  health: number;
  food: number;
  air: number;
  armor: number;
  absorption: number;
  exp: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileNameRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<((model: StatusBarModel) => void) | null>(null);
  const interactionRef = useRef<HotbarInteraction | null>(null);
  const iconsRef = useRef<Array<SlotIcon | null>>(Array(11).fill(null));
  const offhandRef = useRef<OffhandConfig>({ left: false, right: false });
  const overlayRef = useRef<FileNameOverlay | null>(null);
  const scaleRef = useRef(4.5);
  const statsRef = useRef<Stats>({ health: 20, food: 20, air: 20, armor: 20, absorption: 20, exp: 50 });

  const [scale, setScale] = useState(4.5);
  const [stats, setStats] = useState<Stats>(statsRef.current);
  const [pathInput, setPathInput] = useState("");
  const [offhand, setOffhand] = useState<OffhandConfig>({ left: false, right: false });
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const paint = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const interaction = interactionRef.current;
    const drag = interaction?.state.drag ?? null;
    const current = statsRef.current;

    renderer({
      scale: scaleRef.current,
      offhand: offhandRef.current,
      health: current.health,
      maxHealth: 20,
      food: current.food,
      maxFood: 20,
      air: current.air,
      maxAir: 20,
      armor: current.armor,
      maxArmor: 20,
      absorption: current.absorption,
      maxAbsorption: 20,
      exp: current.exp,
      slotIcons: iconsRef.current,
      selectedSlot: interaction?.state.selected ?? -1,
      hoverSlot: interaction?.state.hover ?? -1,
      drag: drag && drag.icon ? { icon: drag.icon, x: drag.x, y: drag.y } : null,
      dragSourceSlot: drag?.source
    });
  }, []);

  const refreshIcons = useCallback(async () => {
    const icons = await Promise.all(
      Array.from({ length: 11 }, (_, globalIndex) => {
        const item = getSlotItem(globalIndex);
        return item ? loadSlotIcon({ path: item.path }) : Promise.resolve(null);
      })
    );
    iconsRef.current = icons;
    paint();
  }, [paint]);

  const buildMenuItems = useCallback(async (globalIndex: number): Promise<MenuItemSpec[]> => {
    const item = getSlotItem(globalIndex);
    const hasClipboard = getClipboard() !== null;

    if (!item) {
      return [{ id: "paste", label: "粘贴", disabled: !hasClipboard }];
    }

    const items: MenuItemSpec[] = [
      { id: "open", label: "打开" },
      { id: "reveal", label: "打开文件所在位置" }
    ];

    if (isExecutable(item.path)) {
      items.push({ id: "admin", label: "以管理员身份运行" });
    }

    items.push(
      { id: "separator-1", label: "", separator: true },
      { id: "copy-path", label: "复制文件地址" },
      { id: "cut", label: "剪切" },
      { id: "copy", label: "复制" },
      { id: "paste", label: "粘贴", disabled: !hasClipboard },
      { id: "separator-2", label: "", separator: true },
      { id: "delete", label: "删除" },
      { id: "rename", label: "重命名" }
    );

    return items;
  }, []);

  const runMenuAction = useCallback(async (action: string, globalIndex: number) => {
    const slotId = slotIdForGlobal(globalIndex);
    const item = getSlotItem(globalIndex);

    switch (action) {
      case "open":
        if (item) await openItem(slotId, item);
        break;
      case "reveal":
        if (item) await revealItem(item);
        break;
      case "admin":
        if (item) await runItemAsAdmin(item);
        break;
      case "copy-path":
        if (item) await copyItemPath(item);
        break;
      case "cut":
        if (item) await cutSlot(slotId, item);
        break;
      case "copy":
        if (item) await copySlot(slotId, item);
        break;
      case "paste":
        await pasteInto(slotId);
        break;
      case "delete":
        deleteSlotContent(slotId);
        break;
      case "rename":
        if (item) await renameItem(item);
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const fileName = fileNameRef.current;
    if (!canvas || !fileName) return;

    let disposed = false;
    let interaction: HotbarInteraction | null = null;

    void createStatusBarRenderer(canvas)
      .then((renderer) => {
        if (disposed) return;
        rendererRef.current = renderer;
        overlayRef.current = new FileNameOverlay(fileName, scaleRef.current, "#FFFFFF");

        const overlay = overlayRef.current;
        const host: HotbarHost = {
          layout: () => computeLayout(scaleRef.current, offhandRef.current),
          getItem: (globalIndex) => getSlotItem(globalIndex),
          getIcon: (globalIndex) => iconsRef.current[globalIndex] ?? null,
          requestRender: paint,
          openSlot: (globalIndex) => {
            const item = getSlotItem(globalIndex);
            if (item) void openItem(slotIdForGlobal(globalIndex), item);
          },
          dropSlot: (globalIndex) => clearSlot(slotIdForGlobal(globalIndex)),
          swapSlots: (source, target) => swapSlots(slotIdForGlobal(source), slotIdForGlobal(target)),
          openMenu: (globalIndex, clientX, clientY) => {
            void (async () => {
              const items = await buildMenuItems(globalIndex);
              const action = await showSlotMenu(items, clientX, clientY);
              if (action) await runMenuAction(action, globalIndex);
            })();
          },
          showFileName: (item) => {
            if (!item || isPathMissing(item.path)) {
              overlay.hideImmediately();
              return;
            }
            overlay.show(displayNameOf(item));
          },
          clickMode: () => "double",
          hoverEnabled: () => true
        };

        interaction = new HotbarInteraction(canvas, host);
        interaction.attach();
        interactionRef.current = interaction;

        void refreshIcons();
      })
      .catch((reason) => setError(String(reason)));

    return () => {
      disposed = true;
      interaction?.destroy();
      interactionRef.current = null;
      rendererRef.current = null;
    };
  }, [buildMenuItems, paint, refreshIcons, runMenuAction]);

  useEffect(() => {
    return subscribeSlots(() => {
      setVersion((current) => current + 1);
      void refreshIcons();
    });
  }, [refreshIcons]);

  useEffect(() => subscribeClipboard(() => setVersion((current) => current + 1)), []);

  useEffect(() => {
    scaleRef.current = scale;
    paint();
  }, [scale, paint, version]);

  useEffect(() => {
    offhandRef.current = offhand;
    paint();
  }, [offhand, paint]);

  const updateStat = (key: keyof Stats, value: number) => {
    statsRef.current = { ...statsRef.current, [key]: value };
    setStats(statsRef.current);
    paint();
  };

  const applyPath = (globalIndex: number, path: string) => {
    const trimmed = path.trim();
    if (!trimmed) {
      clearSlot(slotIdForGlobal(globalIndex));
      return;
    }
    setSlot(slotIdForGlobal(globalIndex), { path: trimmed });
  };

  return (
    <main className="app">
      <header className="title">
        <div>
          <h1>CraftSharp</h1>
          <p>状态栏 Canvas 渲染基线，使用仓库内原版 MC 纹理与真实文件图标</p>
        </div>
        <span className="badge">P1 交互联调</span>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="preview">
        <canvas ref={canvasRef} role="img" aria-label="HUD 状态栏预览" />
        <div ref={fileNameRef} />
      </section>

      <section className="controls">
        <label>
          缩放
          <select value={scale} onChange={(event) => setScale(Number(event.target.value))}>
            <option value={4.5}>4.5x</option>
            <option value={6}>6x</option>
            <option value={9}>9x</option>
          </select>
        </label>

        {(
          [
            ["health", "生命"],
            ["food", "饥饿"],
            ["air", "空气"],
            ["armor", "护甲"],
            ["absorption", "伤害吸收"],
            ["exp", "经验"]
          ] as Array<[keyof Stats, string]>
        ).map(([key, label]) => (
          <label key={key}>
            {label} {stats[key]}
            <input
              type="range"
              min={0}
              max={key === "exp" ? 100 : 20}
              step={key === "air" ? 2 : 1}
              value={stats[key]}
              onChange={(event) => updateStat(key, Number(event.target.value))}
            />
          </label>
        ))}
      </section>

      <section className="icon-source">
        <div className="icon-source-head">
          <h2>快捷栏格子</h2>
          <span className="inline">
            <label>
              <input
                type="checkbox"
                checked={offhand.left}
                onChange={(event) => setOffhand((current) => ({ ...current, left: event.target.checked }))}
              />
              左副手
            </label>
            <label>
              <input
                type="checkbox"
                checked={offhand.right}
                onChange={(event) => setOffhand((current) => ({ ...current, right: event.target.checked }))}
              />
              右副手
            </label>
          </span>
          <button
            type="button"
            onClick={() => {
              SAMPLE_SLOTS.forEach((path, index) => setSlot(slotIdForGlobal(index + 2), { path }));
            }}
          >
            填入示例
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            applyPath(8, pathInput);
          }}
        >
          <input
            type="text"
            value={pathInput}
            spellCheck={false}
            placeholder="文件、文件夹或 .lnk 绝对路径，写入第 9 格"
            onChange={(event) => setPathInput(event.target.value)}
          />
          <button type="submit" disabled={!pathInput.trim()}>
            写入第 9 格
          </button>
        </form>

        <ol className="slot-paths">
          {Array.from({ length: 11 }, (_, globalIndex) => {
            const item = getSlotItem(globalIndex);
            const label = globalIndex === 0 ? "左" : globalIndex === 1 ? "右" : String(globalIndex - 1);
            return (
              <li key={globalIndex}>
                <span className="slot-index">{label}</span>
                <span className="slot-path" title={item?.path ?? "空格子"}>
                  {item?.path ?? "空格子"}
                </span>
                <button
                  type="button"
                  onClick={() => clearSlot(slotIdForGlobal(globalIndex))}
                  disabled={!item}
                >
                  清除
                </button>
              </li>
            );
          })}
        </ol>

        <p className="hint">
          滚轮切换选中，1-9 选择，Enter 打开，Q 丢弃；长按 150ms 后拖动交换，右键打开菜单
        </p>
      </section>
    </main>
  );
}
