import { useState, type ReactNode } from "react";
import { Button as UIButton } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/checkbox";
import { Input } from "@/ui/components/input";
import {
  Select as UISelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/ui/components/select";
import { Switch } from "@/ui/components/switch";
import { cn } from "@/ui/lib/utils";

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

/** Radix Select 不允许空字符串作为选项值，这里用一个内部哨兵转换 */
const EMPTY_VALUE = "__empty__";
const toInternal = (value: string) => (value === "" ? EMPTY_VALUE : value);
const fromInternal = (value: string) => (value === EMPTY_VALUE ? "" : value);

export function SectionHead({ title }: { title: string }) {
  return <h2 className="mb-5 text-xl font-semibold tracking-tight">{title}</h2>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-lg border bg-card text-card-foreground", className)}>{children}</section>;
}

export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 pt-1">{children}</div>;
}

export function SectionSubhead({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 mt-6 text-xs font-medium uppercase tracking-wider text-muted-foreground first:mt-0">
      {children}
    </div>
  );
}

/** 单个设置项：默认独立卡片，plain 用于折叠卡片内部的紧凑行 */
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
  return (
    <div
      className={cn(
        "settings-row flex items-center justify-between gap-4",
        plain ? "border-b py-3.5 last:border-b-0" : "mb-2 rounded-lg border bg-card px-4 py-3.5",
        disabled && "opacity-50"
      )}
    >
      <div className="settings-row-label min-w-0 space-y-1">
        <div className="text-sm font-medium leading-snug">{label}</div>
        {description ? <div className="text-xs leading-snug text-muted-foreground">{description}</div> : null}
      </div>
      <div className="settings-row-control flex flex-none items-center justify-end">{children}</div>
    </div>
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
  return <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  wide = false,
  renderLabel
}: {
  value: T;
  options: Option<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** 长文案（如托盘动作）用更宽的触发器，避免下拉项换行 */
  wide?: boolean;
  /** 自定义选项内容，例如颜色选项的色块 */
  renderLabel?: (option: Option<T>) => ReactNode;
}) {
  return (
    <UISelect
      value={toInternal(value)}
      onValueChange={(next) => onChange(fromInternal(next) as T)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-9 w-auto min-w-[140px] max-w-[280px] [&>span]:truncate",
          wide && "min-w-[240px] max-w-[360px]"
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72 min-w-[var(--radix-select-trigger-width)]">
        {options.map((option) => {
          const internal = toInternal(option.value);
          return (
            <SelectItem key={internal} value={internal}>
              {renderLabel ? renderLabel(option) : option.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </UISelect>
  );
}

export function TextField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  disabled = false,
  className
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Input
      type="text"
      className={cn("h-9 w-[220px] max-w-full", className)}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * 只接受数字输入，失焦或回车时才生效
 * 编辑期间保留原始输入，清空后回落 emptyValue，默认用上限
 */
export function NumberField({
  value,
  min,
  max,
  onChange,
  ariaLabel,
  disabled = false,
  emptyValue
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  ariaLabel: string;
  disabled?: boolean;
  emptyValue?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const parsed = draft === "" ? null : Number(draft);
    const fallback = emptyValue ?? max;
    const next = Math.min(max, Math.max(min, parsed ?? fallback));
    if (next !== value) onChange(next);
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      className="h-9 w-[88px] max-w-full tabular-nums"
      aria-label={ariaLabel}
      value={draft ?? String(value)}
      disabled={disabled}
      onChange={(event) => {
        const text = event.target.value;
        const digits = text.replace(/\D/g, "");
        // 非法字符不会进入状态，这里同步回写受控值，避免输入框残留脏字符
        if (digits !== text) event.target.value = digits;
        setDraft(digits);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export function Button({
  children,
  onClick,
  disabled = false,
  variant = "default",
  primary = false,
  className,
  ariaLabel
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";
  primary?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const danger = variant === "danger";
  return (
    <UIButton
      type="button"
      variant={primary ? (danger ? "destructive" : "default") : "outline"}
      className={cn(!primary && danger && "text-destructive hover:text-destructive", className)}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </UIButton>
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
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm", disabled && "opacity-50")}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(next === true)} />
      <span>{label}</span>
    </label>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "success" }) {
  return (
    <div
      className={cn(
        "mb-3 rounded-lg border px-3 py-2 text-sm leading-snug",
        tone === "info" && "border-border bg-muted/40 text-foreground",
        tone === "warning" && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "success" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      )}
    >
      {children}
    </div>
  );
}
