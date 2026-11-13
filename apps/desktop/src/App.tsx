import { useEffect, useRef, useState } from "react";
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

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [draw, setDraw] = useState<((model: StatusBarModel) => void) | null>(null);
  const [model, setModel] = useState<StatusBarModel>(initialModel);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    createStatusBarRenderer(canvas)
      .then((render) => setDraw(() => render))
      .catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
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

  return (
    <main className="app">
      <header className="title">
        <div>
          <h1>CraftSharp</h1>
          <p>状态栏 Canvas 渲染基线，使用仓库内原版 MC 纹理</p>
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
    </main>
  );
}
