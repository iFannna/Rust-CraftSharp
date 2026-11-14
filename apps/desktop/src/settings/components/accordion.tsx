import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 原版设置页的可折叠卡片：头部是整行卡片，内容区用高度动画展开。
 * 受控时由父级决定开合，用于“记住卡片状态”。
 */
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
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const update = () => setContentHeight(content.scrollHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const toggle = () => {
    const next = !expanded;
    if (open === undefined) setInner(next);
    onOpenChange?.(next);
  };

  return (
    <div className="accordion">
      <button
        type="button"
        className={expanded ? "accordion-header is-open" : "accordion-header"}
        aria-expanded={expanded}
        onClick={toggle}
      >
        <span className="accordion-title">{title}</span>
        <span className="accordion-chevron" aria-hidden="true">
          {"\uE70D"}
        </span>
      </button>
      <div className="accordion-body" style={{ height: expanded ? contentHeight : 0 }}>
        <div className="accordion-content" ref={contentRef}>
          <div className="accordion-card">{children}</div>
        </div>
      </div>
    </div>
  );
}
