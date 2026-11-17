// 皮肤库：清单、当前皮肤映射与图片地址，皮肤页与上传弹窗共用。
import { invoke } from "@tauri-apps/api/core";
import { getConfig, updateConfig, type PlayerConfig, type SkinType } from "@/config/appConfig";
import { PLAYER_SKINS } from "@/entity3d/catalog";

export type { SkinType };

export interface SkinEntry {
  name: string;
  path: string;
}

export type SkinSource =
  | { kind: "builtin"; type: SkinType; name: string }
  | { kind: "custom"; type: SkinType; name: string; path: string };

export const SKIN_TYPES: SkinType[] = ["wide", "slim"];

/** 内置皮肤按名称排序，与老项目目录读取顺序一致 */
export function builtinSources(type: SkinType): SkinSource[] {
  return [...PLAYER_SKINS]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ kind: "builtin", type, name }));
}

export function displayName(source: SkinSource): string {
  if (source.kind === "custom") return source.name;
  return source.name.charAt(0).toUpperCase() + source.name.slice(1);
}

export function sourceKey(source: SkinSource): string {
  return source.kind === "builtin" ? `builtin:${source.type}/${source.name}` : `custom:${source.path}`;
}

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export function fileStem(path: string): string {
  return fileName(path).replace(/\.png$/i, "");
}

function skinTypeOf(value: string): SkinType {
  return value === "slim" ? "slim" : "wide";
}

export function currentSource(player: PlayerConfig): SkinSource {
  const type = skinTypeOf(player.skinType);
  if (player.skinPath) {
    return { kind: "custom", type, name: fileStem(player.skinPath), path: player.skinPath };
  }
  const name = PLAYER_SKINS.includes(player.skinName) ? player.skinName : "steve";
  return { kind: "builtin", type, name };
}

/** 切换标签时的预览回退：当前皮肤同类型沿用，否则同名内置，再回落到 alex */
export function tabSource(type: SkinType): SkinSource {
  const player = getConfig().player;
  if (player.skinPath) {
    if (skinTypeOf(player.skinType) === type) return currentSource(player);
    const sameName = builtinSources(type).find(
      (source) => source.kind === "builtin" && source.name === fileStem(player.skinPath).toLowerCase()
    );
    return sameName ?? { kind: "builtin", type, name: "alex" };
  }
  const name = PLAYER_SKINS.includes(player.skinName) ? player.skinName : "";
  const builtin = builtinSources(type).find(
    (source) => source.kind === "builtin" && source.name === name
  );
  return builtin ?? { kind: "builtin", type, name: "alex" };
}

export function applySkinSource(source: SkinSource) {
  const player = getConfig().player;
  if (source.kind === "builtin") {
    updateConfig({
      player: { ...player, skinName: source.name, skinType: source.type, skinPath: "" }
    });
    return;
  }
  updateConfig({ player: { ...player, skinType: source.type, skinPath: source.path } });
}

const urlCache = new Map<string, Promise<string>>();

/** 内置皮肤走静态资源，上传皮肤由 Rust 读为 data URL */
export function sourceUrl(source: SkinSource): Promise<string> {
  if (source.kind === "builtin") {
    return Promise.resolve(`/textures/entity/player/${source.type}/${source.name}.png`);
  }
  let pending = urlCache.get(source.path);
  if (!pending) {
    pending = invoke<string>("read_skin_data_url", { path: source.path });
    pending.catch(() => urlCache.delete(source.path));
    urlCache.set(source.path, pending);
  }
  return pending;
}

export function forgetSkinUrl(path: string) {
  urlCache.delete(path);
}

export function listSkins(type: SkinType): Promise<SkinEntry[]> {
  return invoke<SkinEntry[]>("list_skins", { skinType: type });
}

export function importSkin(name: string, type: SkinType, dataBase64: string): Promise<SkinEntry> {
  return invoke<SkinEntry>("import_skin", { name, skinType: type, dataBase64 });
}

export function renameSkin(type: SkinType, from: string, to: string): Promise<SkinEntry> {
  return invoke<SkinEntry>("rename_skin", { skinType: type, from, to });
}

export function removeSkin(type: SkinType, name: string): Promise<void> {
  return invoke("remove_skin", { skinType: type, name });
}

/** 与 Rust 侧一致：非空、不超过 32 字符、只允许字母数字下划线横杠空格 */
export function nameError(name: string): "empty" | "long" | "chars" | null {
  const value = name.trim();
  if (!value) return "empty";
  if (value.length > 32) return "long";
  if (!/^[A-Za-z0-9 _-]+$/.test(value)) return "chars";
  return null;
}

export interface SkinFile {
  name: string;
  base64: string;
  url: string;
  width: number;
  height: number;
}

export type SkinFileErrorCode = "tooLarge" | "notPng" | "wrongSize";

export class SkinFileError extends Error {
  constructor(
    readonly code: SkinFileErrorCode,
    readonly width = 0,
    readonly height = 0
  ) {
    super(code);
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_BYTES = 3_000_000;

/** 选文件后先做本地校验，尺寸直接读 PNG 头，不解码像素 */
export async function readSkinFile(file: File): Promise<SkinFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new SkinFileError("tooLarge");
  if (bytes.length < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new SkinFileError("notPng");
  }
  const header = new TextDecoder().decode(bytes.subarray(12, 16));
  if (header !== "IHDR") throw new SkinFileError("notPng");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== 64 || height !== 64) throw new SkinFileError("wrongSize", width, height);

  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return { name: file.name, base64: btoa(binary), url: URL.createObjectURL(file), width, height };
}
