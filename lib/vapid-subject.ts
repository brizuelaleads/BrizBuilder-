const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u;

function emailAddress(value: string): string | null {
  const bracketed = value.match(/^[^<>]*<\s*([^<>]+)\s*>$/u)?.[1] ?? value;
  const email = bracketed.trim();
  return EMAIL.test(email) ? email : null;
}

/**
 * Normalizes the RFC 8292 contact carried in a VAPID JWT.
 *
 * Accepts a bare address, an already-prefixed mailto address, a conventional
 * `Name <address>` From value, or an HTTPS contact URL. Invalid values return
 * null so a misconfigured Worker does not emit tokens push services reject.
 */
export function normalizeVapidSubject(value: string | null | undefined): string | null {
  const subject = value?.trim();
  if (!subject) return null;

  if (/^mailto:/iu.test(subject)) {
    const email = emailAddress(subject.slice("mailto:".length));
    return email ? `mailto:${email}` : null;
  }

  if (/^https:/iu.test(subject)) {
    try {
      const url = new URL(subject);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  const email = emailAddress(subject);
  return email ? `mailto:${email}` : null;
}
