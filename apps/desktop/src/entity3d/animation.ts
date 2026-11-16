// 关键帧动画播放：线性插值、循环、200ms 交叉淡入
// rotation 轨道为绝对角度（度），position 轨道为相对 rest 的偏移
import * as THREE from "three";
import type { BuiltModel } from "./model";
import { copyOverlays } from "./model";

export interface AnimationClip {
  loop: boolean;
  duration: number;
  tracks: Record<string, { rotation?: number[][]; position?: number[][] }>;
}

type Track = number[][];

function sample(track: Track, t: number, loop: boolean, duration: number): number[] {
  if (track.length === 1) return track[0].slice(1);
  let time = t;
  if (loop) time = ((t % duration) + duration) % duration;
  else time = Math.min(Math.max(t, 0), duration);
  for (let i = 0; i < track.length - 1; i += 1) {
    const a = track[i];
    const b = track[i + 1];
    if (time >= a[0] && time <= b[0]) {
      const span = b[0] - a[0];
      const k = span > 0 ? (time - a[0]) / span : 0;
      return [1, 2, 3].map((c) => a[c] + (b[c] - a[c]) * k);
    }
  }
  return track[track.length - 1].slice(1);
}

const FADE = 0.2;

export class AnimationPlayer {
  private current: AnimationClip | null = null;
  private previous: AnimationClip | null = null;
  private time = 0;
  private prevTime = 0;
  private fade = 1;
  playing = true;
  speed = 1;

  play(clip: AnimationClip | null) {
    if (clip === this.current) return;
    this.previous = this.current;
    this.prevTime = this.time;
    this.current = clip;
    this.time = 0;
    this.fade = this.previous ? 0 : 1;
  }

  update(dt: number) {
    if (!this.playing) return;
    this.time += dt * this.speed;
    this.prevTime += dt * this.speed;
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / FADE);
  }

  apply(model: BuiltModel) {
    const { bones, rest } = model;
    for (const [name, node] of bones) {
      const base = rest.get(name)!;
      node.position.copy(base.position);
      node.rotation.copy(base.rotation);
    }
    const root = model.group;
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);

    const blend = (clip: AnimationClip, time: number, weight: number) => {
      for (const [name, channels] of Object.entries(clip.tracks)) {
        const node = name === "root" ? root : bones.get(name);
        if (!node) continue;
        const base = name === "root" ? null : rest.get(name)!;
        if (channels.rotation) {
          const v = sample(channels.rotation, time, clip.loop, clip.duration);
          const target = new THREE.Euler(
            THREE.MathUtils.degToRad(v[0]),
            THREE.MathUtils.degToRad(v[1]),
            THREE.MathUtils.degToRad(v[2])
          );
          if (weight >= 1) node.rotation.copy(target);
          else {
            node.rotation.x += (target.x - node.rotation.x) * weight;
            node.rotation.y += (target.y - node.rotation.y) * weight;
            node.rotation.z += (target.z - node.rotation.z) * weight;
          }
        }
        if (channels.position) {
          const v = sample(channels.position, time, clip.loop, clip.duration);
          const origin = base ? base.position : new THREE.Vector3();
          const target = new THREE.Vector3(origin.x + v[0], origin.y + v[1], origin.z + v[2]);
          if (weight >= 1) node.position.copy(target);
          else node.position.lerp(target, weight);
        }
      }
    };

    if (this.previous && this.fade < 1) blend(this.previous, this.prevTime, 1 - this.fade);
    if (this.current) blend(this.current, this.time, this.fade);
    copyOverlays(bones);
  }
}