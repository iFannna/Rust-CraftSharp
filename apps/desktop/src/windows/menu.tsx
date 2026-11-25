import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MenuItemSpec } from "@/hud/slots/menu";
import { menuHeight } from "@/hud/slots/menu";
import { installLocalHotkeys } from "@/lib/localHotkeys";
import { isTauri } from "@/lib/runtime";
import { ThemeRoot } from "@/ui/theme-root";
import { cn } from "@/ui/lib/utils";
import "@/ui/styles.css";

const params = new URLSearchParams(location.search);
const items: MenuItemSpec[] = JSON.parse(params.get("items") ?? "[]");
const isTray = params.get("variant") === "tray";
const selectEvent = isTray ? "tray-menu:select" : "menu:select";

function close() {
  if (!isTauri()) return;
  void getCurrentWindow().close().catch(() => undefined);
}

function MenuWindow() {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const currentWindow = isTauri() ? getCurrentWindow() : null;
    if (!currentWindow) return;

    const dispose = currentWindow.onFocusChanged(({ payload }) => {
      if (!payload) close();
    });

    const enabledButtons = () =>
      [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];

    // 先按目标宽度完成布局，再按实际内容高度收起窗口，避免窗口带多余空白
    const fit = async () => {
      const targetHeight = menuHeight(items, isTray ? "tray" : "slot");
      const [scale, inner] = await Promise.all([
        currentWindow.scaleFactor(),
        currentWindow.innerSize()
      ]);
      let width = inner.width / scale;
      if (!(width > 40)) width = window.innerWidth;
      // 创建时的高度在 Linux 上可能没生效，显示前先按条目数落一次
      if (width > 40 && Math.abs(inner.height / scale - targetHeight) >= 1) {
        await currentWindow.setSize(new LogicalSize(width, targetHeight)).catch(() => undefined);
      }
      await currentWindow.show().catch(() => undefined);
      await currentWindow.setFocus().catch(() => undefined);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const list = listRef.current;
      if (!list) return;
      const style = getComputedStyle(list);
      const padding =
        (Number.parseFloat(style.paddingTop) || 0) +
        (Number.parseFloat(style.paddingBottom) || 0);
      const border =
        (Number.parseFloat(style.borderTopWidth) || 0) +
        (Number.parseFloat(style.borderBottomWidth) || 0);
      const content = [...list.children].reduce(
        (sum, child) => sum + (child as HTMLElement).offsetHeight,
        0
      );
      const height = Math.max(24, Math.round(content + padding + border));
      if (width > 40 && Math.abs(inner.height / scale - height) >= 1) {
        await currentWindow.setSize(new LogicalSize(width, height)).catch(() => undefined);
      }
      // 物品栏等浮层同为置顶层，菜单需要显式叠到其上方
      await invoke("restack_window", { label: currentWindow.label }).catch(() => undefined);
      enabledButtons()[0]?.focus();
    };
    void fit();

    // 隐藏窗口创建时焦点不生效，显示后补一次
    const focusTimer = window.setTimeout(() => enabledButtons()[0]?.focus(), 60);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      const buttons = enabledButtons();
      if (buttons.length === 0) return;
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = current === -1 ? 0 : (current + step + buttons.length) % buttons.length;
        buttons[next]?.focus();
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
        return;
      }
      if (current === -1 && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        buttons[0]?.click();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      void dispose?.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  return (
    <ThemeRoot>
      <div
        ref={listRef}
        role="menu"
        className={cn(
          "flex h-screen flex-col rounded-lg border bg-popover text-popover-foreground",
          isTray ? "p-1.5" : "p-1"
        )}
      >
        {items.map((item) =>
          item.separator ? (
            <div key={item.id} role="separator" className="my-1 h-px bg-border" />
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cn(
                "flex w-full flex-none cursor-default items-center rounded-sm px-3 text-left text-sm transition-colors",
                isTray ? "h-10 rounded-md" : "h-8",
                !item.disabled && "hover:bg-accent hover:text-accent-foreground",
                item.disabled && "opacity-50"
              )}
              onClick={() => {
                if (isTauri()) void emit(selectEvent, item.id);
              }}
            >
              {item.label}
            </button>
          )
        )}
      </div>
    </ThemeRoot>
  );
}

installLocalHotkeys({ local: false });
ReactDOM.createRoot(document.getElementById("root")!).render(<MenuWindow />);
