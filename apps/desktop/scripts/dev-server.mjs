/**
 * 开发态直接服务生产构建。
 * Vite 开发服务器按需编译，设置面板首开会等 Tailwind 和整棵模块图，
 * 这里改为构建产物即时响应，改动后自动重建并通过 SSE 刷新窗口。
 */

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { build } from "vite";

const root = process.cwd();
const outDir = resolve(root, "dist");
const port = 1420;
const reloadClients = new Set();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm"
};

const RELOAD_SCRIPT = '<script>new EventSource("/__reload").onmessage=()=>location.reload();</script>';

function pagesSignature() {
  const pages = ["index", "settings", "hud", "entity-view"];
  try {
    return pages.map((page) => readFileSync(join(outDir, "pages", `${page}.html`), "utf8")).join("");
  } catch {
    return "";
  }
}

function notifyReload() {
  for (const response of reloadClients) response.write("data: reload\n\n");
}

function sendFile(path, response, headOnly) {
  const ext = extname(path);
  if (ext === ".html") {
    const html = readFileSync(path, "utf8").replace("</body>", `${RELOAD_SCRIPT}</body>`);
    response.writeHead(200, {
      "content-type": MIME[".html"],
      "cache-control": "no-store"
    });
    response.end(headOnly ? undefined : html);
    return;
  }

  const headers = { "content-type": MIME[ext] ?? "application/octet-stream" };
  if (path.startsWith(join(outDir, "assets"))) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  } else if (path.startsWith(join(outDir, "textures"))) {
    headers["cache-control"] = "public, max-age=3600";
  } else {
    headers["cache-control"] = "no-store";
  }
  response.writeHead(200, headers);
  if (headOnly) {
    response.end();
    return;
  }
  createReadStream(path).on("error", () => response.destroy()).pipe(response);
}

function handle(request, response) {
  if (request.url === "/__reload") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    response.write("retry: 500\n\n");
    reloadClients.add(response);
    request.on("close", () => reloadClients.delete(response));
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }

  if (pathname === "/") pathname = "/pages/index.html";
  const path = resolve(outDir, `.${pathname}`);
  if (path !== outDir && !path.startsWith(outDir + sep)) {
    response.writeHead(403).end();
    return;
  }

  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
  } catch {
    response.writeHead(404).end();
    return;
  }
  sendFile(path, response, request.method === "HEAD");
}

const server = createServer(handle);
let listening = false;
let firstBuild = true;
let signature = pagesSignature();

function listen() {
  if (listening) return;
  listening = true;
  server.listen(port, () => {
    console.log(`[dev] 构建产物服务已就绪 http://localhost:${port}`);
  });
}

server.on("error", (error) => {
  console.error(`[dev] 端口 ${port} 不可用`, error);
  process.exit(1);
});

// 已有构建产物时先服务旧版本，避免每次启动都等重建
if (existsSync(join(outDir, "pages", "settings.html"))) listen();

const watcher = await build({
  build: {
    watch: {},
    // 重建时保留旧哈希文件，已打开的窗口不会因缺资源变白
    emptyOutDir: false
  }
});

watcher.on("event", (event) => {
  if (event.code === "ERROR") {
    console.error("[dev] 构建失败", event.error);
    return;
  }
  if (event.code !== "END") return;

  if (!listening) {
    listen();
    firstBuild = false;
    signature = pagesSignature();
    return;
  }

  const next = pagesSignature();
  if (firstBuild) {
    firstBuild = false;
    // 旧产物与首次重建一致时不打断已加载的窗口
    if (next === signature) return;
  }
  signature = next;
  notifyReload();
});

const shutdown = () => {
  watcher.close();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
