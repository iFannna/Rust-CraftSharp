// 实体渲染对外接口：资源注册表 + EntityView
import * as THREE from "three";
import { buildModel, type BuiltModel, type ModelDef } from "./model";
import { AnimationPlayer, type AnimationClip } from "./animation";
import { createScene, type SceneKit } from "./scene";
import { ENTITIES, PLAYER_SKINS, type EntityId } from "./catalog";

export { ENTITIES, PLAYER_SKINS };
export type { EntityId };

const modelModules = import.meta.glob("@assets/models/entity/*.json", { eager: true }) as Record<
  string,
  { default: ModelDef }
>;
const animModules = import.meta.glob("@assets/animations/*/*.json", { eager: true }) as Record<
  string,
  { default: AnimationClip }
>;
const textureUrls = import.meta.glob("@assets/minecraft/textures/entity/**/*.png", {
  eager: true,
  query: "?url",
  import: "default"
}) as Record<string, string>;

const models = new Map<string, ModelDef>();
for (const [key, mod] of Object.entries(modelModules)) {
  models.set(key.slice(key.lastIndexOf("/") + 1, -5), mod.default);
}

const animations = new Map<string, Map<string, AnimationClip>>();
for (const [key, mod] of Object.entries(animModules)) {
  const parts = key.split("/");
  const name = parts[parts.length - 1].slice(0, -5);
  const entity = parts[parts.length - 2];
  if (!animations.has(entity)) animations.set(entity, new Map());
  animations.get(entity)!.set(name, mod.default);
}

const textureKeys = new Map<string, string>();
for (const key of Object.keys(textureUrls)) {
  textureKeys.set(key.slice(key.indexOf("textures/") + 9), key);
}

const loader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();

function prepare(texture: THREE.Texture) {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export async function loadTextures(): Promise<void> {
  await Promise.all(
    [...textureKeys.entries()].map(async ([name, key]) => {
      textures.set(name, prepare(await loader.loadAsync(textureUrls[key])));
    })
  );
}

export async function loadSkinTexture(url: string): Promise<string> {
  const key = `custom:${url}`;
  if (!textures.has(key)) textures.set(key, prepare(await loader.loadAsync(url)));
  return key;
}

export function modelIdFor(entity: EntityId, slim: boolean): string {
  return entity === "player" ? (slim ? "player_slim" : "player_wide") : entity;
}

export function animationsFor(entity: EntityId): string[] {
  const key = entity === "player" ? "player_wide" : entity;
  const names = [...(animations.get(key)?.keys() ?? [])];
  // 待机排第一，作为默认姿态
  names.sort((a, b) => (a === "idle" ? -1 : b === "idle" ? 1 : a.localeCompare(b)));
  return names;
}

export function skinTextureKey(skin: string, slim: boolean): string {
  return `entity/player/${slim ? "slim" : "wide"}/${skin}.png`;
}

export class EntityView {
  readonly kit: SceneKit;
  readonly player = new AnimationPlayer();
  model: BuiltModel | null = null;
  entity: EntityId = "player";
  currentAnimation = "";
  private slim = false;
  private look = { yaw: 0, pitch: 0, headPitch: 0 };
  private cameraMode: "player" | "fit" = "fit";

  constructor(canvas: HTMLCanvasElement, kind: "ortho" | "persp") {
    this.kit = createScene(canvas, kind);
  }

  async load(entity: EntityId, options: { slim?: boolean; skin?: string; skinUrl?: string } = {}) {
    const id = modelIdFor(entity, !!options.slim);
    const def = models.get(id);
    if (!def) throw new Error(`unknown model ${id}`);
    let textureKey = def.texture;
    if (entity === "player") {
      textureKey = options.skinUrl
        ? await loadSkinTexture(options.skinUrl)
        : skinTextureKey(options.skin ?? "steve", !!options.slim);
    }
    const resolved: ModelDef = { ...def, texture: textureKey };
    this.model?.dispose();
    if (this.model) this.kit.scene.remove(this.model.group);
    this.model = buildModel(resolved, textures);
    this.kit.scene.add(this.model.group);
    this.entity = entity;
    this.slim = !!options.slim;
    this.cameraMode = entity === "player" ? "player" : "fit";
    const names = animationsFor(entity);
    this.currentAnimation = names[0] ?? "";
    this.player.play(animations.get(id)?.get(names[0]) ?? null);
    this.reframe();
  }

  setAnimation(name: string) {
    const id = modelIdFor(this.entity, this.slim);
    const clip = animations.get(id)?.get(name);
    this.currentAnimation = clip ? name : "";
    this.player.play(clip ?? null);
  }

  setLook(yaw: number, pitch: number, headPitch: number) {
    this.look = { yaw, pitch, headPitch };
  }

  reframe() {
    if (this.model) this.kit.frame(this.model, this.cameraMode);
  }

  resize(width: number, height: number) {
    this.kit.resize(width, height);
    this.reframe();
  }

  render(dt: number) {
    if (!this.model) return;
    this.player.update(dt);
    this.player.apply(this.model);
    const body = this.model.bones.get("body");
    const head = this.model.bones.get("head");
    if (body) {
      body.rotation.y += THREE.MathUtils.degToRad(this.look.yaw);
      body.rotation.x += THREE.MathUtils.degToRad(this.look.pitch);
    }
    if (head) head.rotation.x += THREE.MathUtils.degToRad(this.look.headPitch);
    this.kit.renderer.render(this.kit.scene, this.kit.camera);
  }

  dispose() {
    this.model?.dispose();
    this.kit.dispose();
  }
}