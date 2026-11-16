// headless Chrome CDP 校验工具：打开页面、等就绪、执行探针、截图
// 用法：node scripts/cdp-shot.mjs <url> <out.png> [probeJs] [waitMs]
import fs from "node:fs";

const [url, out, probeArg, waitMs] = process.argv.slice(2);
const probe = probeArg && probeArg.startsWith("@") ? fs.readFileSync(probeArg.slice(1), "utf8") : probeArg;
const port = process.env.CDP_PORT || 9222;

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 1;
const pending = new Map();
const sessions = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Runtime.exceptionThrown") {
    console.error("PAGE EXCEPTION", JSON.stringify(msg.params.exceptionDetails?.exception?.description ?? msg.params));
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    console.error("PAGE CONSOLE", JSON.stringify(msg.params.args?.map((a) => a.description ?? a.value)));
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
};

function send(method, params = {}, sessionId) {
  const id = nextId++;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Page.navigate", { url }, sessionId);

const deadline = Date.now() + 30000;
let ready = false;
while (Date.now() < deadline) {
  const { result } = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.ready", returnByValue: true }, sessionId);
  if (result.value === "true") { ready = true; break; }
  await new Promise((r) => setTimeout(r, 300));
}
if (!ready) console.error("WARN: page not ready in 30s");
if (waitMs) await new Promise((r) => setTimeout(r, Number(waitMs)));

if (probe) {
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression: probe, returnByValue: true, awaitPromise: true }, sessionId);
  if (exceptionDetails) console.error("PROBE ERROR", JSON.stringify(exceptionDetails));
  else console.log("PROBE", JSON.stringify(result.value));
}

const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
fs.writeFileSync(out, Buffer.from(data, "base64"));
console.log("SHOT", out);
await send("Target.closeTarget", { targetId });
ws.close();
process.exit(0);