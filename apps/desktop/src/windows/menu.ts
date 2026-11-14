import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MenuItemSpec } from "@/hud/slots/menu";

const params = new URLSearchParams(location.search);
const items: MenuItemSpec[] = JSON.parse(params.get("items") ?? "[]");

const container = document.querySelector<HTMLDivElement>("#menu");
if (!container) throw new Error("菜单容器不存在");

const currentWindow = getCurrentWindow();

function close() {
  void currentWindow.close().catch(() => undefined);
}

for (const item of items) {
  if (item.separator) {
    const separator = document.createElement("div");
    separator.className = "separator";
    container.append(separator);
    continue;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = item.label;
  button.disabled = item.disabled ?? false;
  button.addEventListener("click", () => {
    void emit("menu:select", item.id);
  });
  container.append(button);
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
});

void currentWindow.onFocusChanged(({ payload }) => {
  if (!payload) close();
});

void currentWindow.setFocus();
