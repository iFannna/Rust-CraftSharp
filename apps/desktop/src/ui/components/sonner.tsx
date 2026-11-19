/** shadcn Sonner 封装：跟随应用主题，配色走主题变量，宽度按文案自适应 */

import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useAppConfig } from "@/config/useAppConfig";
import { useResolvedTheme } from "@/settings/theme";

export function Toaster(props: ToasterProps) {
  const config = useAppConfig();
  const theme = useResolvedTheme(config.appearance.theme);
  // Sonner 的提示是绝对定位，容器宽度只能固定；提示本身按内容收缩后在容器内居中
  const style = { "--width": "min(90vw, 480px)" } as CSSProperties;

  return (
    <Sonner
      theme={theme}
      position="top-center"
      className="toaster group"
      style={style}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:!w-max group-[.toaster]:!left-0 group-[.toaster]:!right-0 group-[.toaster]:!mx-auto group-[.toaster]:max-w-full group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          content: "group-[.toast]:!w-max group-[.toast]:!flex-auto group-[.toast]:max-w-full",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground"
        }
      }}
      {...props}
    />
  );
}

