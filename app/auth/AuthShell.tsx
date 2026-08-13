import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, ShieldCheck } from "lucide-react";
import { BrandLogo } from "../components/BrandLogo";

export function AuthShell({
  eyebrow,
  title,
  description,
  trustItems,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  trustItems: string[];
  children: ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link className="auth-brand" href="/" aria-label="BrizBuilder home">
          <BrandLogo className="auth-brand-logo" size={136} decorative priority />
        </Link>
        <div className="auth-story-content">
          <div className="auth-story-copy">
            <p>{eyebrow}</p>
            <h1>{title}</h1>
            <span>{description}</span>
          </div>
          <div className="auth-product-preview" aria-hidden="true">
            <Image
              src="/og-calm.png"
              alt=""
              fill
              unoptimized
              sizes="(max-width: 820px) 0px, 55vw"
            />
          </div>
        </div>
        <div className="auth-trust-row">
          {trustItems.map((item) => (
            <span key={item}>
              <Check aria-hidden="true" />
              {item}
            </span>
          ))}
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-card-icon" aria-hidden="true">
            <BrandLogo compact tone="light" size={24} decorative />
          </span>
          {children}
        </div>
      </section>
    </main>
  );
}

export function AuthNote({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-role-note">
      <ShieldCheck aria-hidden="true" />
      <p>
        <strong>{title}</strong>
        <small>{children}</small>
      </p>
    </div>
  );
}
