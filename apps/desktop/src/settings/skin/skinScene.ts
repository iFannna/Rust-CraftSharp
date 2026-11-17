// 皮肤页的 3D 能力：卡片缩略图一次性烘图，右侧预览按需渲染。
// 只加载玩家模型与 idle 动画，不经过全量实体注册表。
import * as THREE from "three";
import { AnimationPlayer, type AnimationClip } from "@/entity3d/animation";
import { buildModel, type BuiltModel, type ModelDef } from "@/entity3d/model";
import wideDef from "@assets/models/entity/player_wide.json";
import slimDef from "@assets/models/entity/player_slim.json";
import idleClip from "@assets/animations/player_wide/idle.json";

export type SkinType = "wide" | "slim";

const DEFS: Record<SkinType, ModelDef> = {
  wide: wideDef as ModelDef,
  slim: slimDef as ModelDef
};
const IDLE = idleClip as AnimationClip;

const loader = new THREE.TextureLoader();
const textureCache = new Map<string, Promise<THREE.Texture>>();

function loadTexture(url: string): Promise<THREE.Texture> {
  let pending = textureCache.get(url);
  if (!pending) {
    pending = loader.loadAsync(url).then((texture) => {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.NoColorSpace;
      return texture;
    });
    pending.catch(() => textureCache.delete(url));
    textureCache.set(url, pending);
  }
  return pending;
}

/** 上传弹窗的临时预览图只在选文件期间有效，关闭前释放对应纹理 */
export function forgetTexture(url: string) {
  const pending = textureCache.get(url);
  if (!pending) return;
  textureCache.delete(url);
  void pending.then((texture) => texture.dispose()).catch(() => undefined);
}

function pose(models: BuiltModel[]) {
  const player = new AnimationPlayer();
  player.play(IDLE);
  for (const model of models) player.apply(model);
}

function build(type: SkinType, texture: THREE.Texture): BuiltModel {
  const def = DEFS[type];
  return buildModel(def, new Map([[def.texture, texture]]));
}

const THUMB_ELEVATION = (35 * Math.PI) / 180;
const THUMB_YAW = (40 * Math.PI) / 180;
const THUMB_TARGET_Y = 16;
const THUMB_DISTANCE = 70;

/** 卡片缩略图：同一皮肤背面与正面并排，一次渲染导出，卡片只放图片 */
export class SkinThumbs {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-21, 21, 21, -21, 0.1, 500);
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 300;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(300, 300, false);
    this.renderer.setClearColor(0x000000, 0);
    // 正面偏上 35° 斜看，头顶与侧身都保留可见
    const sin = Math.sin(THUMB_ELEVATION);
    const cos = Math.cos(THUMB_ELEVATION);
    this.camera.position.set(0, THUMB_TARGET_Y + sin * THUMB_DISTANCE, cos * THUMB_DISTANCE);
    this.camera.lookAt(0, THUMB_TARGET_Y, 0);
  }

  bake(type: SkinType, url: string): Promise<string> {
    const run = this.queue.then(() => this.render(type, url));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async render(type: SkinType, url: string): Promise<string> {
    const texture = await loadTexture(url);
    if (this.disposed) throw new Error("disposed");

    const back = build(type, texture);
    const front = build(type, texture);
    // 缩略图保持模型默认站姿，不叠加待机动画
    const backSlot = new THREE.Group();
    const frontSlot = new THREE.Group();
    // 左背面、右正面，各偏转 40° 让相机同时看到正面、头顶和侧面
    backSlot.position.x = -9;
    backSlot.rotation.y = Math.PI - THUMB_YAW;
    frontSlot.position.x = 9;
    frontSlot.rotation.y = -THUMB_YAW;
    backSlot.add(back.group);
    frontSlot.add(front.group);
    this.scene.add(backSlot, frontSlot);

    try {
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL("image/png");
    } finally {
      this.scene.remove(backSlot, frontSlot);
      back.dispose();
      front.dispose();
    }
  }

  dispose() {
    this.disposed = true;
    this.renderer.dispose();
  }
}

const MIN_ZOOM = 12;
const MAX_ZOOM = 56;
const DEFAULT_ZOOM = 30;
const TARGET = new THREE.Vector3(0, 10, 0);
const DISTANCE = 90;

/** 右侧预览：正交相机，静态待机姿态，只在皮肤、尺寸与操作变化时重绘 */
export class SkinPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 500);
  private model: BuiltModel | null = null;
  private disposed = false;
  private seq = 0;
  private yaw = 0;
  private pitch = 0.245;
  private zoom = DEFAULT_ZOOM;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setClearColor(0x000000, 0);
    this.applyCamera();
  }

  async load(type: SkinType, url: string) {
    const seq = ++this.seq;
    const texture = await loadTexture(url);
    if (this.disposed || seq !== this.seq) return;
    if (this.model) {
      this.scene.remove(this.model.group);
      this.model.dispose();
    }
    this.model = build(type, texture);
    pose([this.model]);
    this.scene.add(this.model.group);
    this.render();
  }

  resize(width: number, height: number) {
    if (this.disposed || width < 1 || height < 1) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.applyFrustum();
    this.render();
  }

  rotate(dx: number, dy: number) {
    this.yaw -= dx * 0.01;
    this.pitch = Math.min(1.4, Math.max(-1.4, this.pitch + dy * 0.01));
    this.applyCamera();
    this.render();
  }

  zoomBy(deltaY: number) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * (1 + deltaY * 0.001)));
    this.applyFrustum();
    this.render();
  }

  reset() {
    this.yaw = 0;
    this.pitch = 0.245;
    this.zoom = DEFAULT_ZOOM;
    this.applyFrustum();
    this.applyCamera();
    this.render();
  }

  private applyFrustum() {
    const aspect = this.width / this.height;
    // 横向宽度按老项目 30 基准，面板过矮时保证整个模型仍在画面内
    const halfH = Math.max(this.zoom / 2 / aspect, 24);
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  private applyCamera() {
    const cos = Math.cos(this.pitch);
    this.camera.position.set(
      TARGET.x + Math.sin(this.yaw) * cos * DISTANCE,
      TARGET.y + Math.sin(this.pitch) * DISTANCE,
      TARGET.z + Math.cos(this.yaw) * cos * DISTANCE
    );
    this.camera.lookAt(TARGET);
  }

  private render() {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.model?.dispose();
    this.model = null;
    this.scene.clear();
    this.renderer.dispose();
  }
}
