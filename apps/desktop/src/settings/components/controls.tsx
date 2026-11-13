import type { ReactNode } from "react";

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

export function SectionHead({ title, description }: { title: string; description: string }) {
  return (
    <header className="section-head">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title ? <p className="card-title">{title}</p> : null}
      {children}
    </section>
  );
}

export function Row({
  label,
  description,
  disabled = false,
  children
}: {
  label: string;
  description?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={disabled ? "row is-disabled" : "row"}>
      <div className="row-text">
        <div className="row-label">{label}</div>
        {description ? <div className="row-desc">{description}</div> : null}
      </div>
      <div className="row-control">{children}</div>
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
  return (
    <select
      className="select"
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({
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
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "is-active" : undefined}
          disabled={disabled}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SliderRow({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
  ariaLabel,
  suffix = ""
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  suffix?: string;
}) {
  return (
    <div className="slider-row">
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="slider-value">
        {value}
        {suffix}
      </span>
    </div>
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
