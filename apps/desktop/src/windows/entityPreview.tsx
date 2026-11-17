// 3D 预览窗口：实体/皮肤/动作切换与相机操作，兼作渲染校验面
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ENTITIES,
  PLAYER_SKINS,
  EntityView,
  animationsFor,
  loadTextures,
  type EntityId
} from "@/entity3d";
import { getConfig, subscribeConfig, updateConfig } from "@/config/appConfig";
import { tOf } from "@/i18n";
import { isTauri } from "@/lib/runtime";
import { useRevealWindow } from "@/lib/windowReveal";
import { applyWindowTitle } from "@/lib/windowTitle";
import { ensureSettingsFonts } from "@/settings/fonts";
import { Button } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/ui/components/select";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import { cn } from "@/ui/lib/utils";
import "@/ui/styles.css";

ensureSettingsFonts();

const ANIMATION_LABELS: Record<string, string> = {
  idle: "待机",
  walk: "走路",
  run: "跑步",
  crouch: "蹲下",
  sit: "坐下",
  bow: "拉弓",
  trident: "举三叉戟",
  wave: "挥手",
  fly: "滑翔",
  swim: "游泳",
  attack: "攻击"
};

const SKIN_OPTIONS = PLAYER_SKINS.map((skin) => ({ value: skin, label: skin }));

const BACKGROUND_OPTIONS: { value: "dark" | "checker"; label: string }[] = [
  { value: "dark", label: "深色" },
  { value: "checker", label: "棋盘格" }
];

// 默认视角与皮肤设置页一致：相机在正面偏上 35°，向模型左侧偏 40°
const DEFAULT_THETA = (40 * Math.PI) / 180;
const DEFAULT_PHI = (55 * Math.PI) / 180;
// 逆时针，约 6 秒一圈
const SPIN_SPEED = (Math.PI * 2) / 6;

interface Orbit {
  theta: number;
  phi: number;
  radius: number;
  target: THREE.Vector3;
}

interface PreviewSelectProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  ariaLabel: string;
}

function PreviewSelect<T extends string>({ value, options, onChange, ariaLabel }: PreviewSelectProps<T>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger aria-label={ariaLabel} className="h-9 w-auto min-w-0 flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72 min-w-[var(--radix-select-trigger-width)]">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-3 text-card-foreground">
      <h3 className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function PreviewRow({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {label ? (
        <span className="w-[52px] flex-none text-[calc(var(--ui-font)_-_1px)] text-muted-foreground">{label}</span>
      ) : null}
      {children}
    </div>
  );
}

function CheckField({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(next) => onChange(next === true)} />
      <span>{label}</span>
    </label>
  );
}

function EntityPreview() {
  useRevealWindow();
  const [entity, setEntity] = useState<EntityId>("player");
  const [skin, setSkin] = useState("steve");
  const [slim, setSlim] = useState(false);
  const [animation, setAnimation] = useState("idle");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [autoRotate, setAutoRotate] = useState(false);
  const [checker, setChecker] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [dragging, setDragging] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const skinInputRef = useRef<HTMLInputElement>(null);

  const viewRef = useRef<EntityView | null>(null);
  const orbitRef = useRef<Orbit>({
    theta: DEFAULT_THETA,
    phi: DEFAULT_PHI,
    radius: 60,
    target: new THREE.Vector3(0, 16, 0)
  });
  const entityRef = useRef<EntityId>("player");
  const animationRef = useRef("idle");
  const wireframeRef = useRef(false);
  const autoRotateRef = useRef(false);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const customSkinUrlRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const lastPlayerJsonRef = useRef<string | null>(null);

  function applyCamera() {
    const view = viewRef.current;
    if (!view) return;
    const camera = view.kit.camera as THREE.PerspectiveCamera;
    const orbit = orbitRef.current;
    const sinPhi = Math.sin(orbit.phi);
    camera.position.set(
      orbit.target.x + orbit.radius * sinPhi * Math.sin(orbit.theta),
      orbit.target.y + orbit.radius * Math.cos(orbit.phi),
      orbit.target.z + orbit.radius * sinPhi * Math.cos(orbit.theta)
    );
    camera.lookAt(orbit.target);
  }

  function resetOrbit() {
    const view = viewRef.current;
    if (!view?.model) return;
    // 先按当前姿态应用到骨骼，包围盒才反映俯卧或滑翔等姿态
    view.player.snap();
    view.player.apply(view.model);
    const bounds = new THREE.Box3().setFromObject(view.model.group);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const orbit = orbitRef.current;
    orbit.target.copy(center);
    orbit.radius = Math.max(size.x, size.y, size.z) * 1.6 + 10;
    orbit.theta = DEFAULT_THETA;
    orbit.phi = DEFAULT_PHI;
  }

  function applyWireframe() {
    const value = wireframeRef.current;
    viewRef.current?.model?.group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        (node.material as THREE.ShaderMaterial).wireframe = value;
      }
    });
  }

  function pickAnimation(preferred?: string) {
    const view = viewRef.current;
    if (!view) return;
    const names = animationsFor(entityRef.current);
    const pick = preferred && names.includes(preferred) ? preferred : names[0];
    animationRef.current = pick;
    setAnimation(pick);
    view.setAnimation(pick);
    resetOrbit();
  }

  async function loadEntity(next: EntityId, preferred?: string) {
    const view = viewRef.current;
    if (!view) return;
    const seq = ++loadSeqRef.current;
    entityRef.current = next;
    setEntity(next);

    const player = getConfig().player;
    const nextSlim = player.skinType === "slim";
    const nextSkin = PLAYER_SKINS.includes(player.skinName) ? player.skinName : "steve";
    setSlim(nextSlim);
    setSkin(nextSkin);

    let skinUrl: string | undefined;
    if (next === "player" && player.skinPath) {
      skinUrl = await invoke<string>("read_skin_data_url", { path: player.skinPath }).catch(() => undefined);
    }
    if (next === "player" && customSkinUrlRef.current) skinUrl = customSkinUrlRef.current;
    if (seq !== loadSeqRef.current) return;

    await view.load(next, { slim: nextSlim, skin: nextSkin, skinUrl });
    if (seq !== loadSeqRef.current) return;
    lastPlayerJsonRef.current = JSON.stringify(getConfig().player);
    resetOrbit();
    pickAnimation(preferred);
    applyWireframe();
  }

  useEffect(() => {
    applyWindowTitle(tOf(getConfig().system.language)("entityPreview.title"));
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const current = getCurrentWindow();
    let dispose: (() => void) | undefined;
    // Alt+F4 也按关闭键处理，窗口保留给托盘再次打开
    void current
      .onCloseRequested((event) => {
        event.preventDefault();
        void current.hide().catch(() => undefined);
      })
      .then((unlisten) => {
        dispose = unlisten;
      })
      .catch(() => undefined);
    return () => dispose?.();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;

    const view = new EntityView(canvas, "persp");
    viewRef.current = view;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const orbit = orbitRef.current;
      orbit.radius = Math.min(600, Math.max(12, orbit.radius * (1 + event.deltaY * 0.001)));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const observer = new ResizeObserver(() => {
      view.resize(viewport.clientWidth, viewport.clientHeight);
    });
    observer.observe(viewport);

    const unsubscribe = subscribeConfig(() => {
      const player = getConfig().player;
      const json = JSON.stringify(player);
      // 首次回调是配置水合，不是用户修改，跳过避免重载打断当前状态
      if (lastPlayerJsonRef.current === null) {
        lastPlayerJsonRef.current = json;
        return;
      }
      if (json === lastPlayerJsonRef.current) return;
      lastPlayerJsonRef.current = json;
      if (entityRef.current === "player") void loadEntity("player", animationRef.current);
    });

    let last = performance.now();
    let fpsAccum = 0;
    let fpsCount = 0;
    let statusAt = 0;
    let frame = 0;
    let disposed = false;

    const tick = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (autoRotateRef.current && !draggingRef.current) orbitRef.current.theta -= dt * SPIN_SPEED;
      applyCamera();
      view.render(dt);
      fpsAccum += dt;
      fpsCount += 1;
      const clock = performance.now();
      if (clock - statusAt > 500) {
        const fps = Math.round(fpsCount / Math.max(fpsAccum, 0.001));
        fpsAccum = 0;
        fpsCount = 0;
        statusAt = clock;
        if (statusRef.current) {
          const bones = view.model?.bones.size ?? 0;
          const label = ENTITIES.find((item) => item.id === entityRef.current)?.label ?? entityRef.current;
          statusRef.current.textContent = `${label} · ${bones} 骨骼 · ${view.currentAnimation || "静止"} · ${fps} FPS`;
        }
      }
      frame = requestAnimationFrame(tick);
    };

    void (async () => {
      await loadTextures();
      await loadEntity("player");
      if (disposed) return;
      view.resize(viewport.clientWidth, viewport.clientHeight);
      frame = requestAnimationFrame(tick);
      document.body.dataset.ready = "true";
    })();

    // 校验探针：headless 测试用
    (window as unknown as Record<string, unknown>).__preview = {
      version: 3,
      THREE,
      view,
      orbit: orbitRef.current,
      animationsFor,
      loadEntity,
      setAnimation: (name: string) => {
        animationRef.current = name;
        setAnimation(name);
        view.setAnimation(name);
      },
      boneRotation: (name: string) => {
        const node = view.model?.bones.get(name);
        return node ? [node.rotation.x, node.rotation.y, node.rotation.z].map((v) => (v * 180) / Math.PI) : null;
      }
    };

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
      canvas.removeEventListener("wheel", onWheel);
      delete document.body.dataset.ready;
      delete (window as unknown as Record<string, unknown>).__preview;
      view.dispose();
      viewRef.current = null;
    };
    // 渲染器与相机只在窗口生命周期内创建一次
  }, []);

  const animationOptions = animationsFor(entity).map((name) => ({
    value: name,
    label: ANIMATION_LABELS[name] ?? name
  }));

  const handleSkinFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    customSkinUrlRef.current = URL.createObjectURL(file);
    const path = (file as File & { path?: string }).path;
    if (path) updateConfig({ player: { skinPath: path } });
    void loadEntity("player", animationRef.current);
  };

  return (
    <ThemeRoot>
      <WindowFrame
        title="Craft#"
        resizable
        onClose={() => {
          if (isTauri()) void getCurrentWindow().hide().catch(() => undefined);
        }}
      >
        <div className="flex min-h-0 flex-1">
          <div
            ref={viewportRef}
            className={cn(
              "relative min-w-0 flex-1 bg-muted dark:bg-background",
              checker && "preview-checker"
            )}
          >
            <canvas
              ref={canvasRef}
              className={cn(
                "absolute inset-0 h-full w-full",
                dragging ? "cursor-grabbing" : "cursor-grab"
              )}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                draggingRef.current = true;
                setDragging(true);
                lastPointerRef.current = { x: event.clientX, y: event.clientY };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!draggingRef.current) return;
                const orbit = orbitRef.current;
                orbit.theta -= (event.clientX - lastPointerRef.current.x) * 0.008;
                orbit.phi = Math.min(
                  Math.PI - 0.15,
                  Math.max(0.15, orbit.phi - (event.clientY - lastPointerRef.current.y) * 0.008)
                );
                lastPointerRef.current = { x: event.clientX, y: event.clientY };
              }}
              onPointerUp={() => {
                draggingRef.current = false;
                setDragging(false);
              }}
              onPointerCancel={() => {
                draggingRef.current = false;
                setDragging(false);
              }}
            />
            <div
              ref={statusRef}
              className="pointer-events-none absolute bottom-2 left-2.5 rounded-md border bg-background/80 px-2 py-0.5 text-xs text-muted-foreground"
            />
          </div>

          <aside className="ui-scroll-auto flex w-[300px] flex-none flex-col gap-3 overflow-y-auto border-l p-3.5">
            <Group title="实体">
              <PreviewRow label="模型">
                <PreviewSelect
                  value={entity}
                  options={ENTITIES.map((item) => ({ value: item.id, label: item.label }))}
                  onChange={(next) => void loadEntity(next, animationRef.current)}
                  ariaLabel="模型"
                />
              </PreviewRow>
            </Group>

            {entity === "player" ? (
              <Group title="皮肤">
                <PreviewRow label="默认">
                  <PreviewSelect
                    value={skin}
                    options={SKIN_OPTIONS}
                    onChange={(next) => {
                      customSkinUrlRef.current = null;
                      updateConfig({ player: { skinName: next, skinPath: "" } });
                      void loadEntity("player", animationRef.current);
                    }}
                    ariaLabel="默认皮肤"
                  />
                </PreviewRow>
                <PreviewRow label="类型">
                  <CheckField
                    checked={slim}
                    onChange={(next) => {
                      updateConfig({ player: { skinType: next ? "slim" : "wide" } });
                      void loadEntity("player", animationRef.current);
                    }}
                    label="slim 细臂"
                  />
                </PreviewRow>
                <PreviewRow label="自定义">
                  <Button
                    type="button"
                    variant="outline"
                    className="px-3"
                    onClick={() => skinInputRef.current?.click()}
                  >
                    选择皮肤文件
                  </Button>
                  <input
                    ref={skinInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={handleSkinFile}
                  />
                </PreviewRow>
              </Group>
            ) : null}

            <Group title="动作">
              <PreviewRow label="姿态">
                <PreviewSelect
                  value={animation}
                  options={animationOptions}
                  onChange={(next) => {
                    animationRef.current = next;
                    setAnimation(next);
                    viewRef.current?.setAnimation(next);
                    resetOrbit();
                  }}
                  ariaLabel="姿态"
                />
              </PreviewRow>
              <PreviewRow label="播放">
                <Button
                  type="button"
                  variant={playing ? "outline" : "secondary"}
                  className="px-3"
                  onClick={() => {
                    const view = viewRef.current;
                    if (!view) return;
                    view.player.playing = !view.player.playing;
                    setPlaying(view.player.playing);
                  }}
                >
                  {playing ? "暂停" : "播放"}
                </Button>
                <input
                  type="range"
                  min={0.25}
                  max={2}
                  step={0.25}
                  value={speed}
                  aria-label="播放速度"
                  className="min-w-0 flex-1 accent-primary"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setSpeed(next);
                    if (viewRef.current) viewRef.current.player.speed = next;
                  }}
                />
                <span className="w-10 flex-none text-right text-xs text-muted-foreground">{speed}x</span>
              </PreviewRow>
            </Group>

            <Group title="相机">
              <PreviewRow>
                <Button type="button" variant="outline" className="px-3" onClick={resetOrbit}>
                  重置视角
                </Button>
                <CheckField
                  checked={autoRotate}
                  onChange={(next) => {
                    autoRotateRef.current = next;
                    setAutoRotate(next);
                  }}
                  label="自动旋转"
                />
              </PreviewRow>
              <div className="text-xs text-muted-foreground">左键拖拽旋转，滚轮缩放</div>
            </Group>

            <Group title="显示">
              <PreviewRow label="背景">
                <PreviewSelect
                  value={checker ? "checker" : "dark"}
                  options={BACKGROUND_OPTIONS}
                  onChange={(next) => setChecker(next === "checker")}
                  ariaLabel="背景"
                />
              </PreviewRow>
              <PreviewRow>
                <CheckField
                  checked={wireframe}
                  onChange={(next) => {
                    wireframeRef.current = next;
                    setWireframe(next);
                    applyWireframe();
                  }}
                  label="线框模式"
                />
              </PreviewRow>
            </Group>
          </aside>
        </div>
      </WindowFrame>
    </ThemeRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<EntityPreview />);
