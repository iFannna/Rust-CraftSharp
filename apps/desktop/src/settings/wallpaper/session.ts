/** mcblock.top 登录态：登录窗口、抓取登录信息与退出，供设置页和壁纸窗口共用 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/lib/runtime";
import { captureSession, logout, sessionStatus } from "./api";
import { openWallpaperLogin } from "./windows";

const SESSION_EVENT = "wallpaper:session";

export function useWallpaperSession(onResult?: (loggedIn: boolean) => void) {
  const [session, setSession] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;

    void sessionStatus()
      .then((value) => {
        if (!cancelled) setSession(value);
      })
      .catch(() => undefined);

    void listen<boolean>(SESSION_EVENT, (event) => {
      if (cancelled) return;
      setSession(event.payload);
      setCapturing(false);
      resultRef.current?.(event.payload);
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

  const finishLogin = useCallback(async () => {
    if (!isTauri()) return;
    setCapturing(true);
    const timer = window.setTimeout(() => setCapturing(false), 6000);
    try {
      await captureSession();
    } catch (reason) {
      window.clearTimeout(timer);
      setCapturing(false);
      throw reason;
    }
  }, []);

  const signOut = useCallback(async () => {
    await logout().catch(() => undefined);
    setSession(false);
  }, []);

  return { session, capturing, openLogin, finishLogin, signOut };
}
