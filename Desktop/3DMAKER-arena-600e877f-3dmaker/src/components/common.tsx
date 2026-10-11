import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { useEditor } from "../store/editor";
import type { Primitive } from "../types";
export function IconButton({
  icon: Icon,
  label,
  caption,
  active = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  caption?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${caption ? "with-caption" : ""} ${active ? "active" : ""} ${className}`}
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={16} strokeWidth={1.7} />
      {caption && <span className="icon-caption">{caption}</span>}
    </button>
  );
}
export function Button({
  children,
  icon: Icon,
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`button button-${variant} ${className}`}
      {...props}
    >
      {Icon && <Icon size={15} strokeWidth={1.8} />}
      {children}
    </button>
  );
}
export function Section({
  title,
  children,
  defaultOpen = true,
  trailing,
  className = "",
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  trailing?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${className}`}>
      <div className="section-heading">
        <button
          className="section-toggle"
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <ChevronDown size={13} className={open ? "" : "-rotate-90"} />
          <span>{title}</span>
        </button>
        {trailing}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
export function NumberInput({
  value,
  onChange,
  min = -10000,
  max = 10000,
  step = 0.1,
  label,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(Number(value.toFixed(4))));
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing) setText(String(Number(value.toFixed(4))));
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      setText(String(Number(value.toFixed(4))));
      return;
    }
    const parsed = Number(text);
    if (text.trim() && Number.isFinite(parsed)) {
      const result = Math.min(max, Math.max(min, parsed));
      if (Math.abs(result - value) > 1e-7) onChange(result);
      setText(String(Number(result.toFixed(4))));
    } else setText(String(Number(value.toFixed(4))));
  };
  return (
    <input
      className="number-input"
      aria-label={label}
      type="number"
      value={text}
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      onFocus={() => {
        cancelled.current = false;
        setEditing(true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
export function RangeInput({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="range-field">
      <span>{label}</span>
      <div className="range-control">
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          style={
            {
              "--range-percent": `${((value - min) / (max - min)) * 100}%`,
            } as React.CSSProperties
          }
          onPointerDown={() => useEditor.getState().beginTransaction()}
          onPointerUp={() =>
            useEditor.getState().endTransaction(`Modifier ${label}`)
          }
          onPointerCancel={() =>
            useEditor.getState().endTransaction(`Modifier ${label}`)
          }
          onKeyDown={() => useEditor.getState().beginTransaction()}
          onKeyUp={() =>
            useEditor.getState().endTransaction(`Modifier ${label}`)
          }
          onBlur={() =>
            useEditor.getState().endTransaction(`Modifier ${label}`)
          }
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="range-value">
          {Number(value.toFixed(2)).toLocaleString("fr-FR")}
        </span>
      </div>
    </label>
  );
}
export function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <div className="color-control">
        <input
          aria-label={label}
          type="color"
          value={value}
          disabled={disabled}
          onFocus={() => useEditor.getState().beginTransaction()}
          onBlur={() =>
            useEditor.getState().endTransaction(`Modifier ${label}`)
          }
          onChange={(e) => onChange(e.target.value)}
        />
        <span>{value.toUpperCase()}</span>
      </div>
    </label>
  );
}
export function Toggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={`switch ${value ? "on" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!value)}
      >
        <span />
      </button>
    </label>
  );
}
export function PrimitiveIcon({
  type,
  size = 22,
}: {
  type: Primitive;
  size?: number;
}) {
  const paths: Record<Primitive, ReactNode> = {
    cube: (
      <>
        <path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" />
        <path d="m3 7 9 5 9-5M12 12v10" />
      </>
    ),
    sphere: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <ellipse cx="12" cy="12" rx="9" ry="3.5" />
      </>
    ),
    cylinder: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 4 16 4 16 0V5M4 19c0-4 16-4 16 0" />
      </>
    ),
    cone: (
      <>
        <path d="m12 2-9 17c0 5 18 5 18 0L12 2Z" />
        <path d="M3 19c0-5 18-5 18 0M12 2v15" />
      </>
    ),
    torus: (
      <>
        <ellipse cx="12" cy="12" rx="10" ry="7" />
        <ellipse cx="12" cy="12" rx="5" ry="3" />
        <path d="M2 12v3c0 9 20 9 20 0v-3" />
      </>
    ),
    plane: (
      <>
        <path d="m12 5 10 7-10 7-10-7 10-7Z" />
        <path d="m7 8 10 8m-10 0 10-8" />
      </>
    ),
    tube: (
      <>
        <path d="M4 19V9c0-10 16-10 16 0v5M8 19V9c0-5 8-5 8 0v5" />
        <ellipse cx="6" cy="19" rx="2" ry="1.5" />
        <ellipse cx="18" cy="14" rx="2" ry="1.5" />
      </>
    ),
    box: (
      <>
        <path d="m12 3 9 5v11l-9 4-9-4V8l9-5Z" />
        <path d="m3 8 9 4 9-4M12 12v11m-5-14 5-3 5 3-5 2-5-2Z" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {paths[type]}
    </svg>
  );
}
export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={26} strokeWidth={1.3} />
      </div>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
