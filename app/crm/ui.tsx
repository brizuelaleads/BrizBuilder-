"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Inbox, X } from "lucide-react";

export function money(cents: number, compact = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: compact ? "compact" : "standard",
  }).format(cents / 100);
}

export function shortDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() !== 2026 ? "numeric" : undefined });
}

export function dateTime(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function initials(name: string) {
  // Words only, so "DEMO — Summit Roofing" reads DS rather than D—.
  return name.split(/\s+/).filter((part) => /^[\p{L}\p{N}]/u.test(part)).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "BL";
}

/**
 * A business's mark: its uploaded logo, or its initials when there is none or
 * the image fails to load. The logo URL has already been validated as https
 * (or root-relative) when it was saved.
 */
export function BusinessMark({ name, logoUrl, className }: { name: string; logoUrl?: string | null; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const showLogo = Boolean(logoUrl) && broken !== logoUrl;
  return (
    <span className={`${className ?? ""}${showLogo ? " has-logo" : ""}`} aria-hidden="true">
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- tenant logos are dynamic storage URLs.
        <img src={logoUrl ?? undefined} alt="" onError={() => setBroken(logoUrl ?? null)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "purple" | "green" | "orange" | "red" | "blue" }) {
  return <span className={`crm-badge crm-badge-${tone}`}>{children}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="crm-empty"><span aria-hidden="true"><Inbox /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Modal({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.contains(document.activeElement)) dialog.focus();
    const keydown = (event: KeyboardEvent) => {
      // Only the topmost dialog handles keys when a workflow opens a nested dialog.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== dialog) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(node => node.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <div className="crm-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} tabIndex={-1} className={`crm-modal ${wide ? "crm-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header><div>{eyebrow ? <p>{eyebrow}</p> : null}<h2 id={titleId}>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close dialog"><X aria-hidden="true" /></button></header>
      {children}
    </section>
  </div>;
}

export function Field({ label, children, span = false }: { label: string; children: ReactNode; span?: boolean }) {
  return <label className={span ? "crm-field-span" : undefined}><span>{label}</span>{children}</label>;
}

export function getFormValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export function localDateTimeInputValue(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
