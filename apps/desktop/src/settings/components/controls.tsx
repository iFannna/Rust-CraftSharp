import { useEffect, useRef, useState, type ReactNode } from "react";

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

export function SectionHead({ title }: { title: string }) {
  return <h2 className="section-title">{title}</h2>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `card ${className}` : "card"}>{children}</section>;
}

export function SectionSubhead({ children }: { children: ReactNode }) {
  return <div className="section-subhead">{children}</div>;
}

/** 单个设置项：每项独立卡片，与原版 ui:Card 一致 */
export function Row({
  label,
  description,
  disabled = false,
  plain = false,
  children
}: {
  label: string;
  description?: ReactNode;
  disabled?: boolean;
  /** 折叠卡片内部的紧凑行，不再套一层卡片 */
  plain?: boolean;
  children: ReactNode;
}) {
  const Tag = plain ? "div" : "section";
  return (
    <Tag className={plain ? (disabled ? "setting-row is-disabled" : "setting-row") : disabled ? "card is-disabled" : "card"}>
      <div className="row">
        <div className="row-text">
          <div className="row-label">{label}</div>
          {description ? <div className="row-desc">{description}</div> : null}
        </div>
        <div className="row-control">{children}</div>
      </div>
    </Tag>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? "switch is-on" : "switch"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel
}: {
  value: T;
  options: Option<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((option) => option.value === value))
  );
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number; minWidth: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  // 打开时把当前项滚到可见区域，并在贴右边缘时回收菜单
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const menu = menuRef.current;
    menu.querySelector<HTMLElement>(".select-option.is-selected")?.scrollIntoView({ block: "nearest" });
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      const left = Math.max(8, window.innerWidth - 8 - rect.width);
      setMenuStyle((previous) =>
        previous && Math.abs(previous.left - left) > 0.5 ? { ...previous, left } : previous
      );
    }
  }, [open, menuStyle]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // 滚动或缩放后固定定位的菜单会脱节，直接收起；菜单内部滚动不算
    const onViewportChange = (event: Event) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open]);

  const choose = (next: T) => {
    onChange(next);
    setOpen(false);
  };

  const toggle = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const estimated = Math.min(264, options.length * 32 + 8);
      const fitsBelow = window.innerHeight - rect.bottom - 8 >= Math.min(estimated, 160);
      setMenuStyle({
        left: rect.left,
        top: fitsBelow ? rect.bottom + 4 : Math.max(8, rect.top - estimated - 4),
        minWidth: rect.width
      });
    }
    setOpen(true);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (!open) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        toggle();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(options.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option.value);
      return;
    }
    if (event.key === "Tab") setOpen(false);
  };

  return (
    <div className="select-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={open ? "select is-open" : "select"}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={toggle}
        onKeyDown={handleKeyDown}
      >
        <span className="select-value">{current?.label ?? ""}</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="select-menu"
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle ?? undefined}
        >
          {options.map((option, index) => {
            const classes = ["select-option"];
            if (option.value === value) classes.push("is-selected");
            if (index === activeIndex) classes.push("is-active");
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={classes.join(" ")}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => choose(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  disabled = false
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      className="text-field"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function NumberField({
  value,
  min,
  max,
  onChange,
  ariaLabel,
  disabled = false
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      className="number-field"
      aria-label={ariaLabel}
      min={min}
      max={max}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (!Number.isFinite(next)) return;
        onChange(Math.min(max, Math.max(min, Math.round(next))));
      }}
    />
  );
}

export function Button({
  children,
  onClick,
  disabled = false,
  variant = "default",
  primary = false
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";
  primary?: boolean;
}) {
  const classes = ["button"];
  if (primary) classes.push("is-primary");
  if (variant === "danger") classes.push("is-danger");

  return (
    <button type="button" className={classes.join(" ")} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function Check({
  checked,
  onChange,
  label,
  disabled = false
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={disabled ? "check is-disabled" : "check"}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "success" }) {
  const classes = ["note"];
  if (tone === "warning") classes.push("is-warning");
  if (tone === "success") classes.push("is-success");

  return <div className={classes.join(" ")}>{children}</div>;
}
