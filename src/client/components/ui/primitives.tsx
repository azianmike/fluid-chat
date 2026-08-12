"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { PublicUser } from "@/shared/types";
import { initialsFor } from "../../format";

/* -------------------------------------------------------------------------- */
/* Avatar                                                                      */
/* -------------------------------------------------------------------------- */

export function Avatar({
  user,
  size = 36,
  presence = true
}: {
  user: Pick<PublicUser, "id" | "displayName" | "avatarUrl" | "avatarColor" | "presence"> | undefined;
  size?: number;
  presence?: boolean;
}) {
  if (!user) {
    return <span className="avatar avatar-placeholder" style={{ width: size, height: size }} aria-hidden />;
  }
  return (
    <span className="avatar-wrap" style={{ width: size, height: size }}>
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="avatar" src={user.avatarUrl} alt="" width={size} height={size} />
      ) : (
        <span
          className="avatar"
          style={{ width: size, height: size, background: user.avatarColor ?? "#4a154b", fontSize: size * 0.42 }}
          aria-hidden
        >
          {initialsFor(user.displayName)}
        </span>
      )}
      {presence ? <PresenceDot presence={user.presence} size={size} /> : null}
    </span>
  );
}

export function PresenceDot({ presence, size = 36 }: { presence: PublicUser["presence"]; size?: number }) {
  const label =
    presence === "active" ? "Active" : presence === "away" ? "Away" : presence === "dnd" ? "Do not disturb" : "Offline";
  return (
    <span
      className={`presence-dot presence-${presence}`}
      style={{ width: Math.max(9, size * 0.3), height: Math.max(9, size * 0.3) }}
      title={label}
      aria-label={label}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

export function IconButton({
  label,
  onClick,
  children,
  active,
  className = "",
  disabled,
  type = "button"
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Popover                                                                     */
/* -------------------------------------------------------------------------- */

export function Popover({
  trigger,
  children,
  align = "start",
  width
}: {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelWidth = width ?? 280;

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!open || !trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    // Room for the panel between the trigger and each edge of the viewport.
    const below = window.innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const flip = panel.scrollHeight > below && above > below;
    const maxHeight = flip ? above : below;
    const left = align === "end" ? rect.right - panelWidth : rect.left;
    setPosition({
      top: flip ? rect.top - gap - Math.min(panel.scrollHeight, maxHeight) : rect.bottom + gap,
      left: Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin)),
      maxHeight
    });
  }, [open, align, panelWidth]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      if (triggerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {trigger({ open, toggle: () => setOpen((value) => !value), ref: triggerRef })}
      {open
        ? createPortal(
            <div className="popover" style={{ width: panelWidth, ...position }} ref={panelRef} role="dialog">
              {children(() => setOpen(false))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export function MenuItem({
  onClick,
  children,
  danger,
  disabled
}: {
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`menu-item ${danger ? "is-danger" : ""}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function MenuDivider() {
  return <div className="menu-divider" />;
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 560,
  align = "center"
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  align?: "center" | "top";
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes, Tab cycles inside the dialog, and focus returns where it started.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => element.offsetParent !== null);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const timer = setTimeout(() => {
      const [first] = focusable();
      (first ?? dialogRef.current)?.focus();
    }, 0);

    document.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={`modal-backdrop align-${align}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

export function Badge({ count, mention }: { count: number; mention?: boolean }) {
  if (count <= 0) return null;
  return <span className={`badge ${mention ? "is-mention" : ""}`}>{count > 99 ? "99+" : count}</span>;
}
