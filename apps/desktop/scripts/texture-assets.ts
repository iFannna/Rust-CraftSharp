/**
 * 贴图按稳定路径提供：/textures/<kind>/<file>.png。
 * 开发态走中间件直接读原图，构建时原样复制到 dist，
 * 避免每张贴图都变成 ESM 模块拖慢页面首次加载。
 */

import { cpSync, createReadStream, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { Plugin } from "vite";

const KINDS = ["block", "item", "entity"] as const;
type TextureKind = (typeof KINDS)[number];

function resolvePng(dir: string, rest: string[]): string | null {
  if (rest.length === 0) return null;
  const path = resolve(dir, ...rest);
  if (!path.startsWith(dir + sep) || extname(path) !== ".png") return null;
  try {
    return statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}

export function textureAssets(assetsRoot: string): Plugin {
  const dirs = Object.fromEntries(
    KINDS.map((kind) => [kind, resolve(assetsRoot, "minecraft/textures", kind)])
  ) as Record<TextureKind, string>;
  let outDir = "";

  return {
    name: "craftsharp:texture-assets",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use("/textures", (req, res, next) => {
        let pathname = (req.url ?? "").split("?")[0];
        try {
          pathname = decodeURIComponent(pathname);
        } catch {
          return next();
        }
        const [kind, ...rest] = pathname.split("/").filter(Boolean);
        const dir = dirs[kind as TextureKind];
        const file = dir ? resolvePng(dir, rest) : null;
        if (!file) return next();
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=3600");
        createReadStream(file)
          .on("error", () => res.destroy())
          .pipe(res);
      });
    },
    closeBundle() {
      if (!outDir) return;
      for (const kind of KINDS) {
        cpSync(dirs[kind], join(outDir, "textures", kind), {
          recursive: true,
          filter: (src) => !extname(src) || extname(src) === ".png"
        });
      }
    }
  };
}
