import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
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
      input: {
        main: resolve(rootDir, "index.html"),
        hud: resolve(rootDir, "hud.html"),
        menu: resolve(rootDir, "menu.html"),
        inventory: resolve(rootDir, "inventory.html"),
        overlay: resolve(rootDir, "overlay.html"),
        settings: resolve(rootDir, "settings.html"),
        crosshair: resolve(rootDir, "crosshair.html"),
        tooltip: resolve(rootDir, "tooltip.html")
      }
    }
  }
});
