export const AI_CONSENT_SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

export function applyAiConsentSecurityHeaders<T extends Response>(response: T): T {
  for (const [name, value] of Object.entries(AI_CONSENT_SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}
