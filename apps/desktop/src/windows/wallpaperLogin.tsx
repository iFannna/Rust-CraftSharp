/** mcblock.top 登录窗口：本地外壳提供与设置面板一致的外框，站点在子 WebView 中保持第一方 Cookie */

import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";
import { getConfig } from "@/config/appConfig";
import { tOf } from "@/i18n";
import { installLocalHotkeys } from "@/lib/localHotkeys";
import { useRevealWindow } from "@/lib/windowReveal";
import { applyWindowTitle } from "@/lib/windowTitle";
import { LOGIN_URL } from "@/settings/wallpaper/api";
import { Button } from "@/ui/components/button";
import { ThemeRoot } from "@/ui/theme-root";
import { WindowFrame } from "@/ui/window-frame";
import "@/ui/styles.css";

const SITE_LABEL = "wallpaper-login-site";
const TITLE_BAR = 32;
const BORDER = 4;

function siteBounds() {
  return {
    x: BORDER,
    y: TITLE_BAR,
    width: Math.max(1, window.innerWidth - BORDER * 2),
    height: Math.max(1, window.innerHeight - TITLE_BAR - BORDER)
  };
}

function WallpaperLoginWindow() {
  useRevealWindow();
  const t = tOf(getConfig().system.language);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    applyWindowTitle(t("wallpaper.loginTitle"));
  }, [t]);

  useEffect(() => {
    const bounds = siteBounds();
    const site = new Webview(getCurrentWindow(), SITE_LABEL, {
      url: LOGIN_URL,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    });
    site.once("tauri://error", () => setFailed(true));

    const layout = () => {
      const next = siteBounds();
      void site.setPosition(new LogicalPosition(next.x, next.y)).catch(() => undefined);
      void site.setSize(new LogicalSize(next.width, next.height)).catch(() => undefined);
    };
    void site.once("tauri://created", layout);
    window.addEventListener("resize", layout);

    return () => {
      window.removeEventListener("resize", layout);
    };
  }, []);

  const close = () => {
    void getCurrentWindow().close().catch(() => undefined);
  };

  return (
    <ThemeRoot>
      <WindowFrame title={t("wallpaper.loginTitle")} controls="full" resizable onClose={close}>
        {failed ? (
          <div className="grid flex-1 place-items-center gap-3 p-6">
            <p className="text-sm text-muted-foreground">{t("wallpaper.loginPageFailed")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void invoke("open_path", { path: LOGIN_URL }).catch(() => undefined)}
            >
              {t("wallpaper.openInBrowser")}
            </Button>
          </div>
        ) : null}
      </WindowFrame>
    </ThemeRoot>
  );
}

installLocalHotkeys({ local: false });
ReactDOM.createRoot(document.getElementById("root")!).render(<WallpaperLoginWindow />);
