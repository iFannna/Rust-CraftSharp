// 从 Mojang 映射反编译源码转录的实体模型数据，转换为本项目 schema
// 来源：MCFireworkDev/MinecraftDeobfuscated-Mojang snapshot 分支，1.20.4 时代
// 坐标约定：Java 模型空间 y 向下，本 schema y 向上且脚底为 0，转换 y = 24 - y_java
// 旋转约定：本 schema 旋转 = (-x_java, y_java, -z_java)，弧度转角度存储
// 用法：node scripts/build-models.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = path.join(root, "assets/models/entity");

const DEG = 180 / Math.PI;

// Java addBox 转录：[x, y, z, w, h, d, u, v, inflate, mirror]
// Java PartPose 转录：pivot [x, y, z]，rest 旋转弧度 [x, y, z]
function bone(name, parent, pivot, cubes, rest = [0, 0, 0], extra = {}) {
  return { name, parent, pivot, rest, cubes, ...extra };
}

function cube(x, y, z, w, h, d, u, v, inflate = 0, mirror = false) {
  return { x, y, z, w, h, d, u, v, inflate, mirror };
}

// box UV 展开为六面矩形，与 Java ModelRenderer 布局一致
function expandUv(c) {
  const { u, v, w, h, d } = c;
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + d + w + d, v + d, w, h]
  };
}

function convertBone(b) {
  // Java 模型空间 y 向下、正面朝 -z；本项目 y 向上、正面朝 +z。
  // 两者相差绕 X 轴 180°，属于刚体旋转：x 不变，y、z 取反，旋转角 (x,-y,-z)。
  // 子骨骼 PartPose 是相对父骨骼的偏移，根骨骼才是绝对坐标
  const pivot = b.parent
    ? [b.pivot[0], -b.pivot[1], -b.pivot[2]]
    : [b.pivot[0], 24 - b.pivot[1], -b.pivot[2]];
  const rotation = [b.rest[0] * DEG, -b.rest[1] * DEG, -b.rest[2] * DEG];
  const cubes = b.cubes.map((c) => ({
    origin: [c.x, -c.y - c.h, -c.z - c.d],
    size: [c.w, c.h, c.d],
    inflate: c.inflate,
    mirror: c.mirror,
    uv: expandUv(c),
    ...(c.texture ? { texture: c.texture } : {}),
    ...(c.emissive ? { emissive: true } : {})
  }));
  return { name: b.name, parent: b.parent, pivot, rotation, cubes, ...(b.visible === false ? { visible: false } : {}) };
}

// 玩家：HumanoidModel.createMesh + PlayerModel.createMesh
function playerMesh(slim) {
  const armW = slim ? 3 : 4;
  // 26.3 起 slim 手臂枢轴与 wide 同为 y=2
  const armY = 2;
  const bones = [
    bone("head", null, [0, 0, 0], [cube(-4, -8, -4, 8, 8, 8, 0, 0)]),
    bone("hat", null, [0, 0, 0], [cube(-4, -8, -4, 8, 8, 8, 32, 0, 0.5)]),
    bone("body", null, [0, 0, 0], [cube(-4, 0, -2, 8, 12, 4, 16, 16)]),
    bone("jacket", null, [0, 0, 0], [cube(-4, 0, -2, 8, 12, 4, 16, 32, 0.25)]),
    bone("right_arm", null, [-5, armY, 0], [cube(-3, -2, -2, armW, 12, 4, 40, 16)]),
    bone("right_sleeve", null, [-5, armY, 0], [cube(-3, -2, -2, armW, 12, 4, 40, 32, 0.25)]),
    bone("left_arm", null, [5, armY, 0], [cube(-1, -2, -2, armW, 12, 4, 32, 48)]),
    bone("left_sleeve", null, [5, armY, 0], [cube(-1, -2, -2, armW, 12, 4, 48, 48, 0.25)]),
    bone("right_leg", null, [-1.9, 12, 0], [cube(-2, 0, -2, 4, 12, 4, 0, 16)]),
    bone("right_pants", null, [-1.9, 12, 0], [cube(-2, 0, -2, 4, 12, 4, 0, 32, 0.25)]),
    bone("left_leg", null, [1.9, 12, 0], [cube(-2, 0, -2, 4, 12, 4, 16, 48)]),
    bone("left_pants", null, [1.9, 12, 0], [cube(-2, 0, -2, 4, 12, 4, 0, 48, 0.25)])
  ];
  // slim 的右臂外缘向内收 1，保持与身体贴合
  if (slim) {
    bones.find((b) => b.name === "right_arm").cubes[0].x = -2;
    bones.find((b) => b.name === "right_sleeve").cubes[0].x = -2;
  }
  return bones;
}

// 苦力怕：CreeperModel.createBodyLayer
const creeperBones = [
  bone("head", null, [0, 6, 0], [cube(-4, -8, -4, 8, 8, 8, 0, 0)]),
  bone("body", null, [0, 6, 0], [cube(-4, 0, -2, 8, 12, 4, 16, 16)]),
  bone("right_hind_leg", null, [-2, 18, 4], [cube(-2, 0, -2, 4, 6, 4, 0, 16)]),
  bone("left_hind_leg", null, [2, 18, 4], [cube(-2, 0, -2, 4, 6, 4, 0, 16)]),
  bone("right_front_leg", null, [-2, 18, -4], [cube(-2, 0, -2, 4, 6, 4, 0, 16)]),
  bone("left_front_leg", null, [2, 18, -4], [cube(-2, 0, -2, 4, 6, 4, 0, 16)])
];

// 铁傀儡：IronGolemModel.createBodyLayer
const golemBones = [
  bone("head", null, [0, -7, -2], [
    cube(-4, -12, -5.5, 8, 10, 8, 0, 0),
    cube(-1, -5, -7.5, 2, 4, 2, 24, 0)
  ]),
  bone("body", null, [0, -7, 0], [
    cube(-9, -2, -6, 18, 12, 11, 0, 40),
    cube(-4.5, 10, -3, 9, 5, 6, 0, 70, 0.5)
  ]),
  bone("right_arm", null, [0, -7, 0], [cube(-13, -2.5, -3, 4, 30, 6, 60, 21)]),
  bone("left_arm", null, [0, -7, 0], [cube(9, -2.5, -3, 4, 30, 6, 60, 58)]),
  bone("right_leg", null, [-4, 11, 0], [cube(-3.5, -3, -3, 6, 16, 5, 37, 0)]),
  bone("left_leg", null, [5, 11, 0], [cube(-3.5, -3, -3, 6, 16, 5, 60, 0, 0, true)])
];

// 村民：VillagerModel.createBodyModel，帽子基础贴图无像素默认隐藏
const villagerBones = [
  bone("head", null, [0, 0, 0], [cube(-4, -10, -4, 8, 10, 8, 0, 0)]),
  bone("hat", "head", [0, 0, 0], [cube(-4, -10, -4, 8, 10, 8, 32, 0, 0.51)], [0, 0, 0], { visible: false }),
  bone("hat_rim", "hat", [0, 0, 0], [cube(-8, -8, -6, 16, 16, 1, 30, 47)], [-Math.PI / 2, 0, 0], { visible: false }),
  bone("nose", "head", [0, -2, 0], [cube(-1, -1, -6, 2, 4, 2, 24, 0)]),
  bone("body", null, [0, 0, 0], [cube(-4, 0, -3, 8, 12, 6, 16, 20)]),
  bone("jacket", "body", [0, 0, 0], [cube(-4, 0, -3, 8, 20, 6, 0, 38, 0.5)]),
  bone("arms", null, [0, 3, -1], [
    cube(-8, -2, -2, 4, 8, 4, 44, 22),
    cube(4, -2, -2, 4, 8, 4, 44, 22, 0, true),
    cube(-4, 2, -2, 8, 4, 4, 40, 38)
  ], [-0.75, 0, 0]),
  bone("right_leg", null, [-2, 12, 0], [cube(-2, 0, -2, 4, 12, 4, 0, 22)]),
  bone("left_leg", null, [2, 12, 0], [cube(-2, 0, -2, 4, 12, 4, 0, 22, 0, true)])
];

// 末影龙：EnderDragonRenderer.createBodyLayer
// 颈尾段在渲染器里是 neck 部件的重复：颈 5 段、尾 12 段，这里展开为骨骼链
const neckCubes = [
  cube(-5, -5, -5, 10, 10, 10, 192, 104),
  cube(-1, -9, -3, 2, 4, 6, 48, 0)
];
const dragonBones = [
  bone("head", "neck5", [0, 0, -10], [
    cube(-6, -1, -24, 12, 5, 16, 176, 44),
    cube(-8, -8, -10, 16, 16, 16, 112, 30),
    cube(-5, -12, -4, 2, 4, 6, 0, 0, 0, true),
    cube(-5, -3, -22, 2, 2, 4, 112, 0, 0, true),
    cube(3, -12, -4, 2, 4, 6, 0, 0),
    cube(3, -3, -22, 2, 2, 4, 112, 0),
    // 龙眼自发光叠层，RenderType.eyes 用同一 UV 区域
    { ...cube(-8, -8, -10, 16, 16, 16, 112, 30, 0.02), texture: "entity/enderdragon/dragon_eyes.png", emissive: true }
  ]),
  bone("jaw", "head", [0, 4, -8], [cube(-6, 0, -16, 12, 4, 16, 176, 65)]),
  bone("body", null, [0, 4, 8], [
    cube(-12, 0, -16, 24, 24, 64, 0, 0),
    cube(-1, -6, -10, 2, 6, 12, 220, 53),
    cube(-1, -6, 10, 2, 6, 12, 220, 53),
    cube(-1, -6, 30, 2, 6, 12, 220, 53)
  ]),
  bone("left_wing", null, [12, 5, 2], [
    cube(0, -4, -4, 56, 8, 8, 112, 88, 0, true),
    cube(0, 0, 2, 56, 0, 56, -56, 88, 0, true)
  ]),
  bone("left_wing_tip", "left_wing", [56, 0, 0], [
    cube(0, -2, -2, 56, 4, 4, 112, 136, 0, true),
    cube(0, 0, 2, 56, 0, 56, -56, 144, 0, true)
  ]),
  bone("right_wing", null, [-12, 5, 2], [
    cube(-56, -4, -4, 56, 8, 8, 112, 88),
    cube(-56, 0, 2, 56, 0, 56, -56, 88)
  ]),
  bone("right_wing_tip", "right_wing", [-56, 0, 0], [
    cube(-56, -2, -2, 56, 4, 4, 112, 136),
    cube(-56, 0, 2, 56, 0, 56, -56, 144)
  ]),
  bone("left_front_leg", null, [12, 20, 2], [cube(-4, -4, -4, 8, 24, 8, 112, 104)]),
  bone("left_front_leg_tip", "left_front_leg", [0, 20, -1], [cube(-3, -1, -3, 6, 24, 6, 226, 138)]),
  bone("left_front_foot", "left_front_leg_tip", [0, 23, 0], [cube(-4, 0, -12, 8, 4, 16, 144, 104)]),
  bone("right_front_leg", null, [-12, 20, 2], [cube(-4, -4, -4, 8, 24, 8, 112, 104)]),
  bone("right_front_leg_tip", "right_front_leg", [0, 20, -1], [cube(-3, -1, -3, 6, 24, 6, 226, 138)]),
  bone("right_front_foot", "right_front_leg_tip", [0, 23, 0], [cube(-4, 0, -12, 8, 4, 16, 144, 104)]),
  bone("left_hind_leg", null, [16, 16, 42], [cube(-8, -4, -8, 16, 32, 16, 0, 0)]),
  bone("left_hind_leg_tip", "left_hind_leg", [0, 32, -4], [cube(-6, -2, 0, 12, 32, 12, 196, 0)]),
  bone("left_hind_foot", "left_hind_leg_tip", [0, 31, 4], [cube(-9, 0, -20, 18, 6, 24, 112, 0)]),
  bone("right_hind_leg", null, [-16, 16, 42], [cube(-8, -4, -8, 16, 32, 16, 0, 0)]),
  bone("right_hind_leg_tip", "right_hind_leg", [0, 32, -4], [cube(-6, -2, 0, 12, 32, 12, 196, 0)]),
  bone("right_hind_foot", "right_hind_leg_tip", [0, 31, 4], [cube(-9, 0, -20, 18, 6, 24, 112, 0)])
];
// 颈链：渲染器起点 (0, 20, -12)，每段沿 -z 步进 10
dragonBones.push(bone("neck1", null, [0, 4, -12], neckCubes));
for (let i = 2; i <= 5; i += 1) dragonBones.push(bone(`neck${i}`, `neck${i - 1}`, [0, 0, -10], neckCubes));
// 尾链：渲染器起点 (0, 10, 60)，每段沿 +z 步进 10，neck 部件几何对称无需翻折
dragonBones.push(bone("tail1", null, [0, 14, 60], neckCubes));
for (let i = 2; i <= 12; i += 1) dragonBones.push(bone(`tail${i}`, `tail${i - 1}`, [0, 0, 10], neckCubes));

const entities = [
  { name: "player_wide", texture: "entity/player/wide/steve.png", size: [64, 64], bones: playerMesh(false) },
  { name: "player_slim", texture: "entity/player/slim/steve.png", size: [64, 64], bones: playerMesh(true) },
  { name: "creeper", texture: "entity/creeper/creeper.png", size: [64, 32], bones: creeperBones },
  { name: "iron_golem", texture: "entity/iron_golem/iron_golem.png", size: [128, 128], bones: golemBones },
  { name: "villager", texture: "entity/villager/villager.png", size: [64, 64], bones: villagerBones },
  { name: "ender_dragon", texture: "entity/enderdragon/dragon.png", size: [256, 256], bones: dragonBones }
];

fs.mkdirSync(outDir, { recursive: true });
for (const entity of entities) {
  const model = {
    name: entity.name,
    texture: entity.texture,
    textureWidth: entity.size[0],
    textureHeight: entity.size[1],
    bones: entity.bones.map(convertBone)
  };
  const file = path.join(outDir, `${entity.name}.json`);
  fs.writeFileSync(file, JSON.stringify(model, null, 2));
  const cubeCount = model.bones.reduce((n, b) => n + b.cubes.length, 0);
  console.log(`${entity.name}: ${model.bones.length} bones, ${cubeCount} cubes`);
}