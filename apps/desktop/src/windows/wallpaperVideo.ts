// X11 桌面层视频：几何与片源由后端给出，页面只负责裁切和播放。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface VideoState {
  url: string;
  poster: string;
  rect: Rect;
  virtualRect: Rect | null;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

const video = document.getElementById("video") as HTMLVideoElement;
let current: VideoState | null = null;
let played = false;

function fit(): void {
  if (!current) return;
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.left = "0px";
  video.style.top = "0px";
  video.style.objectFit = "cover";

  const screen = current.virtualRect;
  if (!screen || video.videoWidth <= 0 || video.videoHeight <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  const zoom = Math.min(3, Math.max(1, current.zoom));
  const offsetX = Math.min(1, Math.max(-1, current.offsetX));
  const offsetY = Math.min(1, Math.max(-1, current.offsetY));
  const scale = Math.max(screen.width / video.videoWidth, screen.height / video.videoHeight) * zoom;
  // 与静态拼接裁切同一套语义：先按虚拟桌面取窗口，再按偏移居中
  const cropWidth = screen.width / scale;
  const cropHeight = screen.height / scale;
  const centerX = clamp(
    video.videoWidth / 2 - offsetX * cropWidth,
    cropWidth / 2,
    video.videoWidth - cropWidth / 2
  );
  const centerY = clamp(
    video.videoHeight / 2 - offsetY * cropHeight,
    cropHeight / 2,
    video.videoHeight - cropHeight / 2
  );
  const left = -(centerX - cropWidth / 2) * scale - (current.rect.left - screen.left);
  const top = -(centerY - cropHeight / 2) * scale - (current.rect.top - screen.top);

  video.style.objectFit = "fill";
  video.style.width = `${(video.videoWidth * scale) / dpr}px`;
  video.style.height = `${(video.videoHeight * scale) / dpr}px`;
  video.style.left = `${left / dpr}px`;
  video.style.top = `${top / dpr}px`;
}

function clamp(value: number, low: number, high: number): number {
  if (low > high) return (low + high) / 2;
  return Math.min(high, Math.max(low, value));
}

function show(next: VideoState): void {
  const changed = !current || current.url !== next.url;
  current = next;
  document.body.style.backgroundImage = next.poster ? `url("${next.poster}")` : "";
  if (changed) {
    played = false;
    video.src = next.url;
    video.load();
    void video.play().catch(() => undefined);
    report("src", next.url);
  }
  fit();
}

/** 播放状态回报给后端，出问题时能在日志里看到原因 */
function report(status: string, detail = ""): void {
  void invoke("wallpaper_video_status", { status, detail }).catch(() => undefined);
}

function resume(): void {
  void video.play().catch(() => undefined);
}

// 全屏应用或锁屏会让 WebKit 停掉媒体管线，解除遮挡后它不会自己续播
let holdPaused = false;
let lastTime = -1;
let frozen = 0;
let armedAt = 0;
let healedAt = 0;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !holdPaused) {
    frozen = 0;
    resume();
  }
});

window.setInterval(() => {
  const now = Date.now();
  if (!current?.url || holdPaused || document.visibilityState !== "visible" || now - armedAt < 8000) {
    lastTime = video.currentTime;
    frozen = 0;
    return;
  }
  if (video.paused) {
    frozen = 0;
    lastTime = video.currentTime;
    resume();
    return;
  }
  if (
    video.currentTime === lastTime &&
    !video.seeking &&
    video.readyState >= 3 &&
    video.networkState !== 2 &&
    now - healedAt > 30000
  ) {
    frozen += 1;
    if (frozen >= 4) {
      frozen = 0;
      healedAt = now;
      report("stuck", `${video.currentTime}`);
      video.load();
      resume();
    }
  } else {
    frozen = 0;
  }
  lastTime = video.currentTime;
}, 2000);

video.addEventListener("loadedmetadata", fit);
video.addEventListener("playing", () => {
  video.style.display = "block";
  armedAt = Date.now();
  if (!played) {
    played = true;
    report("playing");
  }
});
video.addEventListener("pause", () => {
  report("pause", `${video.currentTime}`);
});
video.addEventListener("error", () => {
  video.style.display = "none";
  const error = video.error;
  report("error", error ? `${error.code}:${error.message}` : "");
});
window.addEventListener("resize", fit);

Object.assign(window, {
  __wpPause: (value: boolean) => {
    holdPaused = value;
    if (value) {
      video.pause();
    } else {
      resume();
    }
  }
});

async function load(attempt = 0): Promise<void> {
  const state = await invoke<VideoState | null>("wallpaper_video_state").catch(() => null);
  if (state) {
    show(state);
    return;
  }
  if (attempt < 10) window.setTimeout(() => void load(attempt + 1), 200);
}

void load();
void listen<VideoState>("wallpaper-video", (event) => show(event.payload));
