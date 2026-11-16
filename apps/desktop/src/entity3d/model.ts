// 实体模型 schema 与 three.js 骨骼树构建
// schema 坐标：y 向上脚底为 0，模型面向 +z，单位为贴图像素
import * as THREE from "three";

export interface UvRect {
  top: number[];
  bottom: number[];
  right: number[];
  front: number[];
  left: number[];
  back: number[];
}

export interface CubeDef {
  origin: number[];
  size: number[];
  inflate: number;
  mirror: boolean;
  uv: UvRect;
  texture?: string;
  emissive?: boolean;
}

export interface BoneDef {
  name: string;
  parent: string | null;
  pivot: number[];
  rotation: number[];
  cubes: CubeDef[];
  visible?: boolean;
}

export interface ModelDef {
  name: string;
  texture: string;
  textureWidth: number;
  textureHeight: number;
  bones: BoneDef[];
}

export interface BuiltModel {
  group: THREE.Group;
  bones: Map<string, THREE.Object3D>;
  rest: Map<string, { position: THREE.Vector3; rotation: THREE.Euler }>;
  dispose: () => void;
}

// Java ModelPart.Cube 的六面 UV 映射，按 three BoxGeometry 面序（+x,-x,+y,-y,+z,-z）。
// 本项目正面朝 +z、角色左侧为 +x；每面贴图左沿在几何上的位置由官方顶点表推导：
// 正面 x 最小、背面 x 最大、左侧 z 最大、右侧 z 最小、顶面 x 最小、底面 x 最大；
// 竖直方向贴图顶沿在 y 最大处，顶面在 z 最小处，底面在 z 最小处。
const FACE_UV: Array<{
  rect: keyof UvRect;
  uAxis: "x" | "y" | "z";
  uAtMax: boolean;
  vAxis: "x" | "y" | "z";
  vAtMax: boolean;
}> = [
  { rect: "left", uAxis: "z", uAtMax: false, vAxis: "y", vAtMax: true },
  { rect: "right", uAxis: "z", uAtMax: true, vAxis: "y", vAtMax: true },
  { rect: "top", uAxis: "x", uAtMax: true, vAxis: "z", vAtMax: false },
  { rect: "bottom", uAxis: "x", uAtMax: false, vAxis: "z", vAtMax: false },
  { rect: "front", uAxis: "x", uAtMax: true, vAxis: "y", vAtMax: true },
  { rect: "back", uAxis: "x", uAtMax: false, vAxis: "y", vAtMax: true }
];

function applyUvs(box: THREE.BoxGeometry, uv: UvRect, mirror: boolean, tw: number, th: number) {
  const position = box.attributes.position as THREE.BufferAttribute;
  const data: number[] = [];
  FACE_UV.forEach(({ rect: rectKey, uAxis, uAtMax, vAxis, vAtMax }, slot) => {
    const [rx, ry, rw, rh] = uv[rectKey];
    for (let i = slot * 4; i < slot * 4 + 4; i += 1) {
      const px = position.getX(i);
      const py = position.getY(i);
      const pz = position.getZ(i);
      const isMax = (axis: "x" | "y" | "z") =>
        (axis === "x" ? px : axis === "y" ? py : pz) > -1e-4 ? 1 : 0;
      const uFlag = isMax(uAxis);
      const vFlag = isMax(vAxis);
      const uIdx = uAtMax ? uFlag : 1 - uFlag;
      const vIdx = vAtMax ? 1 - vFlag : vFlag;
      const u = (rx + uIdx * rw) / tw;
      const v = 1 - (ry + vIdx * rh) / th;
      data.push(mirror ? (rx * 2 + rw) / tw - u : u, v);
    }
  });
  (box.attributes.uv as THREE.BufferAttribute).set(new Float32Array(data));
  box.attributes.uv.needsUpdate = true;
}

// MC 按面固定亮度：顶 1 底 0.5 南北 0.8 东西 0.6，用世界法线在片元里算
const SHADE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHADE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float emissive;
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vec4 tex = texture2D(map, vUv);
  if (tex.a < 0.1) discard;
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float shade = n.y > 0.5 ? 1.0 : (n.y < -0.5 ? 0.5 : (abs(n.z) > abs(n.x) ? 0.8 : 0.6));
  shade = mix(shade, 1.0, emissive);
  gl_FragColor = vec4(tex.rgb * shade, tex.a);
}
`;

export function makeMaterial(texture: THREE.Texture, emissive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: texture }, emissive: { value: emissive ? 1 : 0 } },
    vertexShader: SHADE_VERT,
    fragmentShader: SHADE_FRAG,
    side: THREE.DoubleSide,
    transparent: false
  });
}

export function buildModel(def: ModelDef, textures: Map<string, THREE.Texture>): BuiltModel {
  const group = new THREE.Group();
  const bones = new Map<string, THREE.Object3D>();
  const rest = new Map<string, { position: THREE.Vector3; rotation: THREE.Euler }>();
  const disposables: Array<{ dispose: () => void }> = [];

  const baseTexture = textures.get(def.texture);
  if (!baseTexture) throw new Error(`missing texture ${def.texture}`);

  for (const bone of def.bones) {
    const node = new THREE.Object3D();
    node.name = bone.name;
    node.position.set(bone.pivot[0], bone.pivot[1], bone.pivot[2]);
    // MC 骨骼旋转按先 X 后 Y 后 Z 施加，three 用 ZYX 对应同一顺序
    node.rotation.order = "ZYX";
    node.rotation.set(
      THREE.MathUtils.degToRad(bone.rotation[0]),
      THREE.MathUtils.degToRad(bone.rotation[1]),
      THREE.MathUtils.degToRad(bone.rotation[2])
    );
    if (bone.visible === false) node.visible = false;
    bones.set(bone.name, node);
    rest.set(bone.name, { position: node.position.clone(), rotation: node.rotation.clone() });

    for (const cube of bone.cubes) {
      const [w, h, d] = cube.size;
      const inflate = cube.inflate;
      const box = new THREE.BoxGeometry(w + inflate * 2, h + inflate * 2, d + inflate * 2);
      applyUvs(box, cube.uv, cube.mirror, def.textureWidth, def.textureHeight);
      const texture = cube.texture ? textures.get(cube.texture) : baseTexture;
      if (!texture) throw new Error(`missing texture ${cube.texture}`);
      const material = makeMaterial(texture, !!cube.emissive);
      const mesh = new THREE.Mesh(box, material);
      mesh.position.set(
        cube.origin[0] + w / 2,
        cube.origin[1] + h / 2,
        cube.origin[2] + d / 2
      );
      // 零厚度翼膜只留顶面，双面显示避免共面闪烁
      if (h === 0) {
        box.clearGroups();
        box.addGroup(12, 6, 0);
      }
      node.add(mesh);
      disposables.push(box, material);
    }
  }

  for (const bone of def.bones) {
    const node = bones.get(bone.name)!;
    if (bone.parent) bones.get(bone.parent)!.add(node);
    else group.add(node);
  }

  return {
    group,
    bones,
    rest,
    dispose: () => {
      for (const d of disposables) d.dispose();
    }
  };
}

// 覆盖层跟随基础骨骼：hat 跟 head，jacket 跟 body，袖裤跟四肢
const OVERLAY_COPY: Array<[string, string]> = [
  ["hat", "head"],
  ["jacket", "body"],
  ["right_sleeve", "right_arm"],
  ["left_sleeve", "left_arm"],
  ["right_pants", "right_leg"],
  ["left_pants", "left_leg"]
];

export function copyOverlays(bones: Map<string, THREE.Object3D>) {
  for (const [overlay, base] of OVERLAY_COPY) {
    const from = bones.get(base);
    const to = bones.get(overlay);
    if (from && to) {
      to.position.copy(from.position);
      to.rotation.copy(from.rotation);
    }
  }
}