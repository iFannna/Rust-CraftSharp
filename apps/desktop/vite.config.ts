import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = dirname(fileURLToPath(import.meta.url));

/** 每个桌面窗口一个 HTML 入口，统一放在 pages/ */
const pages = ["index", "hud", "menu", "rename", "settings", "entity-preview", "entity-view"];

export default defineConfig({
  plugins: [react()],
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
    }
  },
  envPrefix: ["VITE_", "TAURI_"],
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
