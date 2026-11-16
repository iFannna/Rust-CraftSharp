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
  open,
  defaultOpen = false,
  onOpenChange,
  children
}: {
  title: string;
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
      <AccordionItem value="content" className="rounded-lg border bg-card px-4">
        <AccordionTrigger className="py-3.5 text-sm font-medium hover:no-underline">{title}</AccordionTrigger>
        <AccordionContent className="pb-4 pt-0">{children}</AccordionContent>
      </AccordionItem>
    </AccordionRoot>
  );
}
