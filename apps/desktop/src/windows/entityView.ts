// 离屏实体渲染窗口：物品栏玩家预览出帧，PNG 回读交给原生合成
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EntityView, loadTextures } from "@/entity3d";

interface EntitySetup {
  width: number;
  height: number;
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
let lastSent = 0;
let look: EntityLook = { bodyYaw: 0, bodyPitch: 0, headPitch: 0 };

async function setup(payload: EntitySetup) {
  ready = false;
  canvas.width = Math.max(1, Math.round(payload.width));
  canvas.height = Math.max(1, Math.round(payload.height));
  view.resize(canvas.width, canvas.height);
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
    // 通知原生侧补发当前预览参数，启动期错过的事件不再丢失
    void invoke("entity_view_ready").catch(() => undefined);
  } else {
    // 浏览器预览：按物品栏默认玩家区域比例出图，便于校验
    await setup({ width: 343, height: 490, skin: "steve", skinType: "wide", skinPath: "" });
    active = true;
  }
  requestAnimationFrame(frame);
  document.body.dataset.ready = "true";
}

function frame(now: number) {
  requestAnimationFrame(frame);
  if (!active || !ready) return;
  // 20fps 上限，回读与合成都是每帧成本
  if (now - lastSent < 50) return;
  const dt = lastSent === 0 ? 0.05 : Math.min(0.1, (now - lastSent) / 1000);
  lastSent = now;
  view.setLook(look.bodyYaw, look.bodyPitch, look.headPitch);
  view.render(dt);
  if (!inTauri) return;
  const dataUrl = canvas.toDataURL("image/png");
  void invoke("entity_host_frame", { dataUrl }).catch(() => undefined);
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