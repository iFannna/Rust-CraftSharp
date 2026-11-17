// 物品栏玩家预览：透明覆盖层直接渲染，像素不再回读到原生层
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EntityView, loadTextures } from "@/entity3d";

interface EntitySetup {
  skin: string;
  skinType: string;
  skinPath: string;
}

interface EntityLook {
  bodyYaw: number;
  bodyPitch: number;
  headPitch: number;
}

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const view = new EntityView(canvas, "ortho");
const inTauri = Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
let active = false;
let ready = false;
let last = 0;
let look: EntityLook = { bodyYaw: 0, bodyPitch: 0, headPitch: 0 };

// 画布跟随窗口视口，物理像素出图、CSS 铺满，DPI 变化由 resize 自动纠正
function fit() {
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(window.innerWidth * scale));
  const height = Math.max(1, Math.round(window.innerHeight * scale));
  view.resize(width, height);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
}

async function setup(payload: EntitySetup) {
  ready = false;
  fit();
  const skinUrl = payload.skinPath
    ? await invoke<string>("read_skin_data_url", { path: payload.skinPath }).catch(() => undefined)
    : undefined;
  await view.load("player", {
    slim: payload.skinType === "slim",
    skin: payload.skin,
    skinUrl
  });
  view.setAnimation("idle");
  ready = true;
}

async function boot() {
  // 贴图就绪后再注册监听，避免首批事件落在加载过程中
  await loadTextures();
  if (inTauri) {
    await Promise.all([
      listen<EntitySetup>("entity-setup", ({ payload }) => void setup(payload)),
      listen<EntityLook>("entity-look", ({ payload }) => {
        look = payload;
      }),
      listen<{ visible: boolean }>("entity-active", ({ payload }) => {
        active = payload.visible;
      })
    ]);
    // 通知原生侧补发当前预览参数并登记覆盖层窗口
    void invoke("entity_view_ready").catch(() => undefined);
  } else {
    // 浏览器预览：按物品栏默认玩家区域比例出图，便于校验
    await setup({ skin: "steve", skinType: "wide", skinPath: "" });
    active = true;
  }
  window.addEventListener("resize", fit);
  requestAnimationFrame(frame);
  document.body.dataset.ready = "true";
}

function frame(now: number) {
  requestAnimationFrame(frame);
  if (!active || !ready) return;
  const dt = last === 0 ? 1 / 60 : Math.min(0.1, (now - last) / 1000);
  last = now;
  view.setLook(look.bodyYaw, look.bodyPitch, look.headPitch);
  view.render(dt);
}

// 校验探针：headless 测试用
(window as unknown as Record<string, unknown>).__entityView = {
  view,
  setup,
  setActive: (value: boolean) => {
    active = value;
  },
  setLook: (next: EntityLook) => {
    look = next;
  }
};

void boot();
