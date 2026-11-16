import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { textureAssets } from "./scripts/texture-assets";

const rootDir = dirname(fileURLToPath(import.meta.url));

/** 每个桌面窗口一个 HTML 入口，统一放在 pages/ */
const pages = [
  "index",
  "hud",
  "menu",
  "rename",
  "confirm",
  "icon-picker",
  "settings",
  "entity-preview",
  "entity-view"
];

export default defineConfig({
  plugins: [react(), textureAssets(resolve(rootDir, "../../assets"))],
  clearScreen: false,
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
      "@assets": resolve(rootDir, "../../assets")
    }
  },
  server: {
    port: 1420,
    strictPort: true,
    fs: {
      allow: ["../.."]
    },
    // 窗口创建时依赖树已经编译完，打开设置、HUD 不必再等首次转换
    warmup: {
      clientFiles: [
        "./src/settings/index.tsx",
        "./src/settings/sections/*.tsx",
        "./src/windows/hud.ts",
        "./src/App.tsx"
      ]
    }
  },
  envPrefix: ["VITE_", "TAURI_"],
  optimizeDeps: {
    // 依赖一次预构建到位，避免运行中重新优化触发整页 reload
    holdUntilCrawlEnd: false,
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/api/window",
      "@tauri-apps/api/dpi",
      "@tauri-apps/api/webviewWindow",
      "@radix-ui/react-accordion",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-select",
      "@radix-ui/react-slot",
      "@radix-ui/react-switch",
      "class-variance-authority",
      "clsx",
      "tailwind-merge",
      "three"
    ]
  },
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: Object.fromEntries(
        pages.map((page) => [page === "index" ? "main" : page, resolve(rootDir, `pages/${page}.html`)])
      )
    }
  }
});
