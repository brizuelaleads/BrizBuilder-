"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "./access.module.css";

export function AccessRequestForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.get("name"),
          email: fields.get("email"),
          business: fields.get("business"),
          message: fields.get("message"),
          website: fields.get("website"),
          consent: fields.get("consent") === "on",
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Your request could not be saved. Please try again.",
        );
      setConfirmation(result.message);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your request could not be saved. Please try again.",
      );
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  return (
    <>
      {confirmation ? (
        <div className="local-login-success" role="status">
          <strong>Request received</strong>
          <p>{confirmation}</p>
          <Link href="/">Back to BrizBuilder</Link>
        </div>
      ) : (
        <form
          className={`local-login-form ${styles.form}`}
          onSubmit={submit}
          aria-busy={busy}
        >
          <label>
            <span>Your name</span>
            <input name="name" autoComplete="name" maxLength={100} required />
          </label>
          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
            />
          </label>
          <label>
            <span>Business name</span>
            <input
              name="business"
              autoComplete="organization"
              maxLength={160}
              required
            />
          </label>
          <label>
            <span>
              How can we help? <small>(optional)</small>
            </span>
            <textarea name="message" rows={3} maxLength={2000} />
          </label>
          <div hidden aria-hidden="true">
            <label>
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <label className={styles.consent}>
            <input name="consent" type="checkbox" required />
            <span>
              I agree to be contacted about my access request. See our{" "}
              <Link href="/privacy">privacy policy</Link>.
            </span>
          </label>
          {error ? (
            <p className="crm-inline-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="auth-signin" type="submit" disabled={busy}>
            <span>{busy ? "Submitting…" : "Request access"}</span>
            <ArrowRight aria-hidden="true" />
          </button>
        </form>
      )}
      <p className="auth-secondary-link">
        Already invited? <Link href="/login">Log in</Link>
      </p>
      <p className="auth-secondary-link">
        Need help? <a href="mailto:brizuelaleads@gmail.com">Contact support</a>
      </p>
    </>
  );
}
