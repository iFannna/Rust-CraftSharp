// 烘焙实体动画为本项目关键帧 schema
// 玩家姿态常数来自 HumanoidModel.setupAnim / PlayerModel（Mojang 映射反编译，1.20.4 时代）
// 生物步态来自 CreeperModel / IronGolemModel / VillagerModel.setupAnim
// 末影龙来自 EnderDragonRenderer.DragonModel.renderToBuffer
// wave/swim 关键帧来自基岩官方 player.animation.json（Mojang bedrock-samples）
// 旋转存储为本项目约定角度：Java 模型空间绕 X 轴转 180° 后的 (x,-y,-z) 弧度转角度
// 用法：node scripts/build-animations.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outRoot = path.join(root, "assets/animations");
const DEG = 180 / Math.PI;
const SAMPLES = 32;

// Java 弧度旋转向量转本项目角度
const rot = (x, y, z) => [x * DEG, -y * DEG, -z * DEG];

function bake(duration, fn, loop = true) {
  const tracks = {};
  for (let i = 0; i <= SAMPLES; i += 1) {
    const t = (i / SAMPLES) * duration;
    const pose = fn(t, (i / SAMPLES) * Math.PI * 2);
    for (const [bone, channels] of Object.entries(pose)) {
      tracks[bone] ??= {};
      for (const [channel, value] of Object.entries(channels)) {
        tracks[bone][channel] ??= [];
        tracks[bone][channel].push([Number(t.toFixed(4)), ...value.map((v) => Number(v.toFixed(4)))]);
      }
    }
  }
  return { loop, duration, tracks };
}

function still(pose) {
  const tracks = {};
  for (const [bone, channels] of Object.entries(pose)) {
    tracks[bone] = {};
    for (const [channel, value] of Object.entries(channels)) {
      tracks[bone][channel] = [[0, ...value]];
    }
  }
  return { loop: true, duration: 1, tracks };
}

// 走路 limbSwing 公式，g 为摆幅系数，T 为预览周期
function walkPose(T, g = 1) {
  return bake(T, (t, phase) => {
    const c = Math.cos(phase);
    const s = Math.cos(phase + Math.PI);
    return {
      right_arm: { rotation: rot(s * 2 * g * 0.5, 0, 0) },
      left_arm: { rotation: rot(c * 2 * g * 0.5, 0, 0) },
      right_leg: { rotation: rot(c * 1.4 * g, 0.005, 0.005) },
      left_leg: { rotation: rot(s * 1.4 * g, -0.005, -0.005) }
    };
  });
}

// idle 手臂摆动：AnimationUtils.bobModelPart，age 按 20tick/s
const idle = bake(4, (t) => {
  const age = t * 20;
  const bob = (side) => ({
    rotation: [
      side * Math.sin(age * 0.067) * 0.05 * DEG,
      0,
      -side * (Math.cos(age * 0.09) * 0.05 + 0.05) * DEG
    ]
  });
  return { right_arm: bob(1), left_arm: bob(-1) };
});

// 蹲下：setupAnim crouching 分支，位置为相对 rest 的偏移
const crouch = still({
  body: { rotation: rot(0.5, 0, 0), position: [0, -3.2, 0] },
  head: { position: [0, -4.2, 0] },
  right_arm: { rotation: rot(0.4, 0, 0), position: [0, -3.2, 0] },
  left_arm: { rotation: rot(0.4, 0, 0), position: [0, -3.2, 0] },
  right_leg: { position: [0, -0.2, -4] },
  left_leg: { position: [0, -0.2, -4] }
});

// 坐下：riding 分支
const sit = still({
  right_arm: { rotation: rot(-Math.PI / 5, 0, 0) },
  left_arm: { rotation: rot(-Math.PI / 5, 0, 0) },
  right_leg: { rotation: rot(-1.4137167, Math.PI / 10, 0.07853982) },
  left_leg: { rotation: rot(-1.4137167, -Math.PI / 10, -0.07853982) }
});

// 拉弓：BOW_AND_ARROW，主手右手，头部角度取 0
const bow = still({
  right_arm: { rotation: rot(-Math.PI / 2, -0.1, 0) },
  left_arm: { rotation: rot(-Math.PI / 2, 0.5, 0) }
});

// 三叉戟举矛：THROW_SPEAR，右臂 -π，叠加 idle 摆动
const trident = bake(4, (t) => {
  const age = t * 20;
  const bobZ = (Math.cos(age * 0.09) * 0.05 + 0.05) * DEG;
  return {
    right_arm: { rotation: [-Math.PI * DEG, 0, -bobZ] },
    left_arm: { rotation: [-Math.sin(age * 0.067) * 0.05 * DEG, 0, bobZ] }
  };
});

// 挥手：基岩 celebrating，角度转本项目约定
const wave = bake(0.45, (t, phase) => {
  const sway = Math.cos(phase) * 2.865;
  return {
    left_arm: { rotation: [sway, -180, 135] },
    right_arm: { rotation: [sway, -180, -153] }
  };
});

// 鞘翅滑翔：整体水平来自 LivingEntityRenderer fallFlying，头部 -π/4 来自 setupAnim，手臂后掠 π/2
const fly = still({
  root: { rotation: [90, 0, 0] },
  head: { rotation: rot(-Math.PI / 4, 0, 0) },
  right_arm: { rotation: rot(Math.PI / 2, 0, 0) },
  left_arm: { rotation: rot(Math.PI / 2, 0, 0) },
  right_leg: { rotation: rot(0.26, 0, 0) },
  left_leg: { rotation: rot(0.26, 0, 0) }
});

// 游泳：手臂关键帧来自基岩 swim，腿部踢水来自 setupAnim swimAmount 分支
const swimArms = {
  left_arm: [[0, 0, -180, -180], [0.7, 0, -180, -287.2], [1.1, 90, -180, -180], [1.3, 0, -180, -180]],
  right_arm: [[0, 0, -180, 180], [0.7, 0, -180, 287.2], [1.1, 90, -180, 180], [1.3, 0, -180, 180]]
};
const swim = {
  loop: true,
  duration: 1.3,
  tracks: {
    root: { rotation: [[0, 90, 0, 0]] },
    left_arm: { rotation: swimArms.left_arm },
    right_arm: { rotation: swimArms.right_arm },
    left_leg: { rotation: Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const t = (i / SAMPLES) * 1.3;
      return [Number(t.toFixed(4)), Number((0.3 * Math.cos((t / 1.3) * Math.PI * 2 + Math.PI) * DEG).toFixed(4)), 0, 0];
    }) },
    right_leg: { rotation: Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const t = (i / SAMPLES) * 1.3;
      return [Number(t.toFixed(4)), Number((0.3 * Math.cos((t / 1.3) * Math.PI * 2) * DEG).toFixed(4)), 0, 0];
    }) }
  }
};

// 苦力怕步态：对角腿同相，摆幅 1.4
const creeperWalk = bake(1, (t, phase) => {
  const a = Math.cos(phase) * 1.4;
  const b = Math.cos(phase + Math.PI) * 1.4;
  return {
    right_hind_leg: { rotation: rot(b, 0, 0) },
    left_hind_leg: { rotation: rot(a, 0, 0) },
    right_front_leg: { rotation: rot(a, 0, 0) },
    left_front_leg: { rotation: rot(b, 0, 0) }
  };
});

// 铁傀儡：triangleWave 步态，Mth.triangleWave(x, p) = 2 * (x/p - floor(x/p + 0.5))
const tri = (x, p) => 2 * (x / p - Math.floor(x / p + 0.5));
const golemWalk = bake(1.3, (t) => {
  const w = tri(t * 10, 13);
  return {
    right_leg: { rotation: rot(-1.5 * w, 0, 0) },
    left_leg: { rotation: rot(1.5 * w, 0, 0) },
    right_arm: { rotation: rot(-0.2 + 1.5 * w, 0, 0) },
    left_arm: { rotation: rot(-0.2 - 1.5 * w, 0, 0) }
  };
});
const golemAttack = bake(0.5, (t) => {
  const w = tri(t * 20, 10);
  return {
    right_arm: { rotation: rot(-2 + 1.5 * w, 0, 0) },
    left_arm: { rotation: rot(-2 + 1.5 * w, 0, 0) }
  };
});

// 村民步态：摆幅减半
const villagerWalk = bake(1, (t, phase) => ({
  right_leg: { rotation: rot(Math.cos(phase) * 1.4 * 0.5, 0, 0) },
  left_leg: { rotation: rot(Math.cos(phase + Math.PI) * 1.4 * 0.5, 0, 0) }
}));

// 末影龙悬停扇翅：翼/颌/颈/尾公式来自 renderToBuffer，腿部静态角来自 renderSide
const dragonFly = bake(1.6, (t, w) => {
  const pose = {
    jaw: { rotation: rot((Math.sin(w) + 1) * 0.2, 0, 0) },
    left_wing: { rotation: rot(0.125 - Math.cos(w) * 0.2, -0.25, -(Math.sin(w) + 0.125) * 0.8) },
    left_wing_tip: { rotation: rot(0, 0, (Math.sin(w + 2) + 0.5) * 0.75) },
    right_wing: { rotation: rot(0.125 - Math.cos(w) * 0.2, 0.25, (Math.sin(w) + 0.125) * 0.8) },
    right_wing_tip: { rotation: rot(0, 0, -(Math.sin(w + 2) + 0.5) * 0.75) },
    left_hind_leg: { rotation: rot(1, 0, 0) },
    left_hind_leg_tip: { rotation: rot(0.5, 0, 0) },
    left_hind_foot: { rotation: rot(0.75, 0, 0) },
    right_hind_leg: { rotation: rot(1, 0, 0) },
    right_hind_leg_tip: { rotation: rot(0.5, 0, 0) },
    right_hind_foot: { rotation: rot(0.75, 0, 0) },
    left_front_leg: { rotation: rot(1.3, 0, 0) },
    left_front_leg_tip: { rotation: rot(-0.5, 0, 0) },
    left_front_foot: { rotation: rot(0.75, 0, 0) },
    right_front_leg: { rotation: rot(1.3, 0, 0) },
    right_front_leg_tip: { rotation: rot(-0.5, 0, 0) },
    right_front_foot: { rotation: rot(0.75, 0, 0) }
  };
  for (let i = 1; i <= 5; i += 1) {
    pose[`neck${i}`] = { rotation: rot(Math.cos((i - 1) * 0.45 + w) * 0.15, 0, 0) };
  }
  let v = 0;
  for (let i = 1; i <= 12; i += 1) {
    v += Math.sin((i - 1) * 0.45 + w) * 0.05;
    pose[`tail${i}`] = { rotation: rot(v, 0, 0) };
  }
  return pose;
});

const empty = still({});

const library = {
  player_wide: { idle, walk: walkPose(1), run: walkPose(0.55), crouch, sit, bow, trident, wave, fly, swim },
  creeper: { idle: empty, walk: creeperWalk },
  iron_golem: { idle: empty, walk: golemWalk, attack: golemAttack },
  villager: { idle: empty, walk: villagerWalk },
  ender_dragon: { fly: dragonFly }
};
// slim 与 wide 共用玩家动画
library.player_slim = library.player_wide;

for (const [entity, poses] of Object.entries(library)) {
  const dir = path.join(outRoot, entity);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, anim] of Object.entries(poses)) {
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(anim));
  }
  console.log(`${entity}: ${Object.keys(poses).join(", ")}`);
}