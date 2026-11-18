/** 壁纸页的轻量提示，成功与失败共用，2 秒自动消失 */

import { useCallback, useEffect, useRef, useState } from "react";

export function useToast(duration = 2000) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = useCallback(
    (next: string) => {
      setMessage(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMessage(null), duration);
    },
    [duration]
  );

  return { message, show };
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-8 left-1/2 z-[70] -translate-x-1/2 animate-in rounded-md border bg-card px-4 py-2 text-sm text-card-foreground shadow-lg fade-in-0 slide-in-from-bottom-1"
    >
      {message}
    </div>
  );
}
