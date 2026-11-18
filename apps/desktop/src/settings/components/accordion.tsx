import { useState, type ReactNode } from "react";
import {
  Accordion as AccordionRoot,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/ui/components/accordion";

/** 折叠卡片：受控时由父级决定开合，用于记住卡片状态 */
export function Accordion({
  title,
  description,
  open,
  defaultOpen = false,
  onOpenChange,
  children
}: {
  title: string;
  description?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const expanded = open ?? inner;
  const value = expanded ? "content" : "";

  return (
    <AccordionRoot
      type="single"
      collapsible
      value={value}
      onValueChange={(next) => {
        const openNext = next === "content";
        if (open === undefined) setInner(openNext);
        onOpenChange?.(openNext);
      }}
      className="mb-2"
    >
      <AccordionItem
        value="content"
        className="rounded-lg border bg-card px-4 has-[h3>button:focus-visible]:ring-1 has-[h3>button:focus-visible]:ring-ring"
      >
        <AccordionTrigger className="py-3.5 text-sm font-medium transition-colors hover:no-underline focus-visible:outline-none">
          <div className="min-w-0 space-y-1">
            <div className="leading-snug">{title}</div>
            {description ? (
              <div className="text-xs font-normal leading-snug text-muted-foreground">{description}</div>
            ) : null}
          </div>
        </AccordionTrigger>
        <AccordionContent className="pb-4 pt-0">{children}</AccordionContent>
      </AccordionItem>
    </AccordionRoot>
  );
}
