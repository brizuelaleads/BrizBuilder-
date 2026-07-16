"use client";

import type { ReactNode } from "react";

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
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "BL";
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "purple" | "green" | "orange" | "red" | "blue" }) {
  return <span className={`crm-badge crm-badge-${tone}`}>{children}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="crm-empty"><span>+</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Modal({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="crm-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`crm-modal ${wide ? "crm-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="crm-modal-title">
      <header><div>{eyebrow ? <p>{eyebrow}</p> : null}<h2 id="crm-modal-title">{title}</h2></div><button type="button" onClick={onClose} aria-label="Close dialog">×</button></header>
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
