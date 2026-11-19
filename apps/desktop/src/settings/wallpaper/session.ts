/** MCBlock 登录态：登录窗口、自动抓取与退出，供设置页和壁纸窗口共用 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/lib/runtime";
import { logout, sessionStatus } from "./api";
import { openWallpaperLogin } from "./windows";

const SESSION_EVENT = "wallpaper:session";

export function useWallpaperSession(onLogin?: () => void) {
  const [session, setSession] = useState(false);
  const loginRef = useRef(onLogin);
  loginRef.current = onLogin;

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    let attempt = 0;

    // 窗口早于 Rust 初始化创建，登录态可能还没解密完，未命中时短暂重试
    const read = () => {
      void sessionStatus()
        .then((value) => {
          if (cancelled) return;
          setSession((current) => current || value);
          if (!value && attempt < 3) {
            attempt += 1;
            window.setTimeout(read, 400);
          }
        })
        .catch(() => undefined);
    };
    read();

    void listen<boolean>(SESSION_EVENT, (event) => {
      if (cancelled) return;
      setSession(event.payload);
      if (event.payload) loginRef.current?.();
    }).then((off) => {
      if (cancelled) off();
      else dispose = off;
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  const openLogin = useCallback(async (title: string) => {
    if (!isTauri()) return;
    await openWallpaperLogin(title);
  }, []);

  const signOut = useCallback(async () => {
    await logout().catch(() => undefined);
    setSession(false);
  }, []);

  return { session, openLogin, signOut };
}
