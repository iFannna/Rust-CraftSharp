// 场景与相机：正交用于物品栏预览，透视用于预览窗口
import * as THREE from "three";
import type { BuiltModel } from "./model";

export interface SceneKit {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  resize: (width: number, height: number) => void;
  frame: (model: BuiltModel, mode: "player" | "fit") => void;
  dispose: () => void;
}

export function createScene(canvas: HTMLCanvasElement, kind: "ortho" | "persp"): SceneKit {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera =
    kind === "ortho"
      ? new THREE.OrthographicCamera(-14, 14, 14, -14, 0.1, 500)
      : new THREE.PerspectiveCamera(45, 1, 0.1, 2000);

  const resize = (width: number, height: number) => {
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(1);
    if (camera instanceof THREE.OrthographicCamera) {
      // 物品栏契约：模型 32 单位占区域高度的 58/70，等效半高 19.31
      const halfH = 19.31;
      const halfW = halfH * (width / height);
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
    } else {
      camera.aspect = width / height;
    }
    camera.updateProjectionMatrix();
  };

  const bounds = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  const frame = (model: BuiltModel, mode: "player" | "fit") => {
    bounds.setFromObject(model.group);
    bounds.getCenter(center);
    bounds.getSize(size);
    if (camera instanceof THREE.OrthographicCamera) {
      // 玩家脚底 0 头顶 32，相机对准半高，正前方
      const targetY = mode === "player" ? 16 : center.y;
      camera.position.set(0, targetY, -100);
      camera.lookAt(0, targetY, 0);
    } else {
      const radius = Math.max(size.x, size.y, size.z) * 0.75 + 8;
      camera.position.set(-radius * 0.7, center.y + radius * 0.35, -radius * 0.9);
      camera.lookAt(center);
    }
    camera.updateProjectionMatrix();
  };

  return {
    scene,
    renderer,
    camera,
    resize,
    frame,
    dispose: () => renderer.dispose()
  };
}