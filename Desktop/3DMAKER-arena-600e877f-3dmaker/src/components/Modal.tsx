import { useEffect, useRef, type ReactNode } from "react";
import { Settings2, X } from "lucide-react";
import { useEditor } from "../store/editor";
import { IconButton } from "./common";
export function Modal({
  title,
  subtitle,
  icon: Icon = Settings2,
  children,
  footer,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: typeof Settings2;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const headingId = "dialog-heading";
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        useEditor.getState().openDialog(null);
      }
      if (e.key === "Tab") {
        const inputs = Array.from(
          root.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
          ) || [],
        ).filter((element) => element.getClientRects().length > 0);
        const first = inputs[0],
          last = inputs.at(-1);
        if (!first || !last) return;
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === root.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => {
      document.removeEventListener("keydown", handler, true);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) useEditor.getState().openDialog(null);
      }}
    >
      <div
        ref={root}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={`modal ${className}`}
      >
        <header className="modal-header">
          <span className="modal-icon">
            <Icon size={21} />
          </span>
          <div>
            <h2 id={headingId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton
            icon={X}
            label="Fermer la fenêtre de dialogue"
            onClick={() => useEditor.getState().openDialog(null)}
          />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
