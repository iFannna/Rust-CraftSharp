// 3D 预览窗口：实体/皮肤/动作切换与相机操作，兼作渲染校验面
import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";
import {
  ENTITIES,
  PLAYER_SKINS,
  EntityView,
  animationsFor,
  loadTextures,
  type EntityId
} from "@/entity3d";
import { getConfig, subscribeConfig, updateConfig } from "@/config/appConfig";

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

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const viewport = document.getElementById("viewport") as HTMLDivElement;
const status = document.getElementById("status") as HTMLDivElement;
const entitySelect = document.getElementById("entity") as HTMLSelectElement;
const skinGroup = document.getElementById("skinGroup") as HTMLDivElement;
const skinSelect = document.getElementById("skin") as HTMLSelectElement;
const slimCheck = document.getElementById("slim") as HTMLInputElement;
const skinFile = document.getElementById("skinFile") as HTMLButtonElement;
const skinInput = document.getElementById("skinInput") as HTMLInputElement;
const animationSelect = document.getElementById("animation") as HTMLSelectElement;
const playButton = document.getElementById("play") as HTMLButtonElement;
const speedInput = document.getElementById("speed") as HTMLInputElement;
const speedValue = document.getElementById("speedValue") as HTMLSpanElement;
const resetButton = document.getElementById("resetView") as HTMLButtonElement;
const autoRotateCheck = document.getElementById("autoRotate") as HTMLInputElement;
const backgroundSelect = document.getElementById("background") as HTMLSelectElement;
const wireframeCheck = document.getElementById("wireframe") as HTMLInputElement;

const view = new EntityView(canvas, "persp");
const orbit = { theta: -0.66, phi: 1.21, radius: 60, target: new THREE.Vector3(0, 16, 0) };
let entity: EntityId = "player";
let customSkinUrl: string | null = null;
let lastPlayerJson: string | null = null;
let loadSeq = 0;

for (const item of ENTITIES) {
  entitySelect.add(new Option(item.label, item.id));
}
for (const skin of PLAYER_SKINS) {
  skinSelect.add(new Option(skin, skin));
}

function fillAnimations(preferred?: string) {
  const names = animationsFor(entity);
  animationSelect.innerHTML = "";
  for (const name of names) {
    animationSelect.add(new Option(ANIMATION_LABELS[name] ?? name, name));
  }
  const pick = preferred && names.includes(preferred) ? preferred : names[0];
  animationSelect.value = pick;
  view.setAnimation(pick);
  resetOrbit();
}

function resetOrbit() {
  if (!view.model) return;
  // 先按当前姿态应用到骨骼，包围盒才反映俯卧或滑翔等姿态
  view.player.snap();
  view.player.apply(view.model);
  const bounds = new THREE.Box3().setFromObject(view.model.group);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  orbit.target.copy(center);
  orbit.radius = Math.max(size.x, size.y, size.z) * 1.1 + 10;
  orbit.theta = -0.66;
  orbit.phi = 1.21;
}

function applyCamera() {
  const camera = view.kit.camera as THREE.PerspectiveCamera;
  const sinPhi = Math.sin(orbit.phi);
  camera.position.set(
    orbit.target.x + orbit.radius * sinPhi * Math.sin(orbit.theta),
    orbit.target.y + orbit.radius * Math.cos(orbit.phi),
    orbit.target.z + orbit.radius * sinPhi * Math.cos(orbit.theta)
  );
  camera.lookAt(orbit.target);
}

async function loadEntity(next: EntityId, preferredAnimation?: string) {
  const seq = ++loadSeq;
  entity = next;
  entitySelect.value = next;
  const player = getConfig().player;
  const slim = player.skinType === "slim";
  slimCheck.checked = slim;
  skinSelect.value = PLAYER_SKINS.includes(player.skinName) ? player.skinName : "steve";
  skinGroup.style.display = next === "player" ? "" : "none";
  let skinUrl: string | undefined;
  if (next === "player" && player.skinPath) {
    skinUrl = await invoke<string>("read_skin_data_url", { path: player.skinPath }).catch(() => undefined);
  }
  if (next === "player" && customSkinUrl) skinUrl = customSkinUrl;
  if (seq !== loadSeq) return;
  await view.load(next, { slim, skin: skinSelect.value, skinUrl });
  if (seq !== loadSeq) return;
  lastPlayerJson = JSON.stringify(getConfig().player);
  resetOrbit();
  fillAnimations(preferredAnimation);
  applyWireframe();
}

function applyWireframe() {
  view.model?.group.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      (node.material as THREE.ShaderMaterial).wireframe = wireframeCheck.checked;
    }
  });
}

entitySelect.addEventListener("change", () => void loadEntity(entitySelect.value as EntityId, animationSelect.value));
skinSelect.addEventListener("change", () => {
  customSkinUrl = null;
  updateConfig({ player: { skinName: skinSelect.value, skinPath: "" } });
  void loadEntity("player", animationSelect.value);
});
slimCheck.addEventListener("change", () => {
  updateConfig({ player: { skinType: slimCheck.checked ? "slim" : "wide" } });
  void loadEntity("player", animationSelect.value);
});
skinFile.addEventListener("click", () => skinInput.click());
skinInput.addEventListener("change", () => {
  const file = skinInput.files?.[0];
  if (!file) return;
  customSkinUrl = URL.createObjectURL(file);
  const path = (file as File & { path?: string }).path;
  if (path) updateConfig({ player: { skinPath: path } });
  void loadEntity("player", animationSelect.value);
});
animationSelect.addEventListener("change", () => {
  view.setAnimation(animationSelect.value);
  resetOrbit();
});
playButton.addEventListener("click", () => {
  view.player.playing = !view.player.playing;
  playButton.textContent = view.player.playing ? "暂停" : "播放";
  playButton.classList.toggle("on", !view.player.playing);
});
speedInput.addEventListener("input", () => {
  view.player.speed = Number(speedInput.value);
  speedValue.textContent = `${speedInput.value}x`;
});
resetButton.addEventListener("click", resetOrbit);
backgroundSelect.addEventListener("change", () => {
  viewport.classList.toggle("checker", backgroundSelect.value === "checker");
});
wireframeCheck.addEventListener("change", applyWireframe);

let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  dragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  canvas.classList.add("dragging");
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  orbit.theta -= (event.clientX - lastX) * 0.008;
  orbit.phi = Math.min(Math.PI - 0.15, Math.max(0.15, orbit.phi - (event.clientY - lastY) * 0.008));
  lastX = event.clientX;
  lastY = event.clientY;
});
canvas.addEventListener("pointerup", () => {
  dragging = false;
  canvas.classList.remove("dragging");
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  orbit.radius = Math.min(600, Math.max(12, orbit.radius * (1 + event.deltaY * 0.001)));
}, { passive: false });

new ResizeObserver(() => {
  view.resize(viewport.clientWidth, viewport.clientHeight);
}).observe(viewport);

subscribeConfig(() => {
  const player = getConfig().player;
  const json = JSON.stringify(player);
  // 首次回调是配置水合，不是用户修改，跳过避免重载打断当前状态
  if (lastPlayerJson === null) {
    lastPlayerJson = json;
    return;
  }
  if (json === lastPlayerJson) return;
  lastPlayerJson = json;
  if (entity === "player") void loadEntity("player", animationSelect.value);
});

let last = performance.now();
let fps = 0;
let fpsAccum = 0;
let fpsCount = 0;
let statusAt = 0;

function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (autoRotateCheck.checked && !dragging) orbit.theta += dt * 0.4;
  applyCamera();
  view.render(dt);
  fpsAccum += dt;
  fpsCount += 1;
  const clock = performance.now();
  if (clock - statusAt > 500) {
    fps = Math.round(fpsCount / Math.max(fpsAccum, 0.001));
    fpsAccum = 0;
    fpsCount = 0;
    statusAt = clock;
    const bones = view.model?.bones.size ?? 0;
    status.textContent = `${ENTITIES.find((e) => e.id === entity)?.label ?? entity} · ${bones} 骨骼 · ${view.currentAnimation || "静止"} · ${fps} FPS`;
  }
  requestAnimationFrame(tick);
}

async function boot() {
  await loadTextures();
  entitySelect.value = "player";
  await loadEntity("player");
  view.resize(viewport.clientWidth, viewport.clientHeight);
  requestAnimationFrame(tick);
  document.body.dataset.ready = "true";
}

void boot();

// 校验探针：headless 测试用
(window as unknown as Record<string, unknown>).__preview = {
  version: 3,
  THREE,
  view,
  orbit,
  animationsFor,
  loadEntity,
  setAnimation: (name: string) => {
    animationSelect.value = name;
    view.setAnimation(name);
  },
  boneRotation: (name: string) => {
    const node = view.model?.bones.get(name);
    return node ? [node.rotation.x, node.rotation.y, node.rotation.z].map((v) => (v * 180) / Math.PI) : null;
  }
};