import { useEffect, useRef, useState, type FormEvent } from "react";
import { hasIconBackend, invalidateSlotIcons, loadSlotIcon } from "./hud/iconService";
import { loadMockSlotIcons } from "./hud/mockIcons";
import { createStatusBarRenderer, type StatusBarModel } from "./hud/statusbar";

const initialModel: StatusBarModel = {
  scale: 4.5,
  health: 20,
  maxHealth: 20,
  food: 20,
  maxFood: 20,
  air: 20,
  maxAir: 20,
  armor: 20,
  maxArmor: 20,
  absorption: 20,
  maxAbsorption: 20,
  exp: 50,
  selectedSlot: -1
};

/** 覆盖可执行文件、文件夹、图片、系统模块和文件丢失五种情况 */
const sampleSlotPaths: Array<string | null> = [
  "C:\\Windows\\System32\\notepad.exe",
  "C:\\Windows",
  "C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg",
  "C:\\Windows\\System32\\shell32.dll",
  "Z:\\craftsharp-missing\\file.txt",
  null,
  null,
  null,
  null
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [draw, setDraw] = useState<((model: StatusBarModel) => void) | null>(null);
  const [model, setModel] = useState<StatusBarModel>(initialModel);
  const [error, setError] = useState<string | null>(null);
  const [slotPaths, setSlotPaths] = useState<Array<string | null>>(sampleSlotPaths);
  const [showTargetIcon, setShowTargetIcon] = useState(false);
  const [customPath, setCustomPath] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    createStatusBarRenderer(canvas)
      .then((render) => setDraw(() => render))
      .catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const pending = slotPaths.map((path) =>
      path ? loadSlotIcon({ path, showTargetIcon }) : Promise.resolve(null)
    );

    Promise.all(pending).then((icons) => {
      if (!cancelled) setModel((current) => ({ ...current, slotIcons: icons }));
    });

    return () => {
      cancelled = true;
    };
  }, [slotPaths, showTargetIcon]);

  useEffect(() => {
    if (hasIconBackend()) return;

    loadMockSlotIcons().then((slotIcons) => {
      setModel((current) => ({ ...current, slotIcons }));
    });
  }, []);

  useEffect(() => {
    draw?.(model);
  }, [draw, model]);

  const update = (patch: Partial<StatusBarModel>) => {
    setModel((current) => ({ ...current, ...patch }));
  };

  const applyCustomPath = (event: FormEvent) => {
    event.preventDefault();
    const path = customPath.trim();
    if (!path) return;

    invalidateSlotIcons(path);
    setSlotPaths((current) => {
      const next = current.slice();
      next[8] = path;
      return next;
    });
  };

  return (
    <main className="app">
      <header className="title">
        <div>
          <h1>CraftSharp</h1>
          <p>状态栏 Canvas 渲染基线，使用仓库内原版 MC 纹理与真实文件图标</p>
        </div>
        <span className="badge">P1 垂直切片</span>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="preview">
        <canvas ref={canvasRef} role="img" aria-label="HUD 状态栏预览" />
      </section>

      <section className="controls">
        <label>
          缩放
          <select value={model.scale} onChange={(event) => update({ scale: Number(event.target.value) })}>
            <option value={4.5}>4.5x</option>
            <option value={6}>6x</option>
            <option value={9}>9x</option>
          </select>
        </label>

        <label>
          生命 {model.health}
          <input
            type="range"
            min={0}
            max={20}
            value={model.health}
            onChange={(event) => update({ health: Number(event.target.value) })}
          />
        </label>

        <label>
          饥饿 {model.food}
          <input
            type="range"
            min={0}
            max={20}
            value={model.food}
            onChange={(event) => update({ food: Number(event.target.value) })}
          />
        </label>

        <label>
          空气 {model.air}
          <input
            type="range"
            min={0}
            max={20}
            step={2}
            value={model.air}
            onChange={(event) => update({ air: Number(event.target.value) })}
          />
        </label>

        <label>
          护甲 {model.armor}
          <input
            type="range"
            min={0}
            max={20}
            value={model.armor}
            onChange={(event) => update({ armor: Number(event.target.value) })}
          />
        </label>

        <label>
          伤害吸收 {model.absorption}
          <input
            type="range"
            min={0}
            max={20}
            value={model.absorption}
            onChange={(event) => update({ absorption: Number(event.target.value) })}
          />
        </label>

        <label>
          经验 {model.exp}
          <input
            type="range"
            min={0}
            max={100}
            value={model.exp}
            onChange={(event) => update({ exp: Number(event.target.value) })}
          />
        </label>
      </section>

      <section className="icon-source">
        <div className="icon-source-head">
          <h2>格子图标来源</h2>
          <label className="inline">
            <input
              type="checkbox"
              checked={showTargetIcon}
              onChange={(event) => setShowTargetIcon(event.target.checked)}
            />
            快捷方式显示目标图标
          </label>
        </div>

        <form onSubmit={applyCustomPath}>
          <input
            type="text"
            value={customPath}
            spellCheck={false}
            placeholder="文件、文件夹或 .lnk 绝对路径"
            onChange={(event) => setCustomPath(event.target.value)}
          />
          <button type="submit" disabled={!customPath.trim()}>
            载入第 9 格
          </button>
        </form>

        <ol className="slot-paths">
          {slotPaths.map((path, index) => (
            <li key={index}>
              <span className="slot-index">{index + 1}</span>
              <span className="slot-path" title={path ?? "空格子"}>
                {path ?? "空格子"}
              </span>
            </li>
          ))}
        </ol>

        <p className="hint">
          {hasIconBackend()
            ? "图标由 Rust 侧提取：图片文件直读，其余走 Shell 大图标，文件丢失显示屏障占位图"
            : "当前为浏览器预览，图标提取不可用，显示的是模拟图标"}
        </p>
      </section>
    </main>
  );
}
