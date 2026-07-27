import { createClient } from "../../../../utils/supabase/server";

export const dynamic = "force-dynamic";

// Per-isolate throttle: it resets on cold start and is not shared between
// isolates, so it slows guessing rather than stopping a distributed attack.
// Supabase Auth also throttles sign-in server-side, and a Cloudflare Rate
// Limiting rule on this path is the durable, edge-wide layer.
//
// Failures escalate the lockout so a slow grinder does not get a fresh
// allowance every minute; a success clears the record entirely.
const MAX_ATTEMPTS_PER_WINDOW = 8;
const WINDOW_MS = 60_000;
const MAX_LOCKOUT_MS = 15 * 60_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function throttled(key: string): boolean {
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || bucket.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (attempts.size > 5_000) {
      const oldest = attempts.keys().next().value;
      if (oldest) attempts.delete(oldest);
    }
    return false;
  }
  bucket.count += 1;
  if (bucket.count > MAX_ATTEMPTS_PER_WINDOW) {
    const over = bucket.count - MAX_ATTEMPTS_PER_WINDOW;
    bucket.resetAt = now + Math.min(WINDOW_MS * 2 ** over, MAX_LOCKOUT_MS);
    return true;
  }
  return false;
}

function clearThrottle(key: string) {
  attempts.delete(key);
}

function redirectTo(request: Request, path: string, error?: string) {
  const url = new URL(path, request.url);
  if (error) url.searchParams.set("error", error);
  return new Response(null, {
    status: 303,
    headers: { Location: url.toString(), "Cache-Control": "no-store" },
  });
}

function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 16_384) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  try {
    const url = new URL(value, "https://brizbuilder.local");
    if (url.origin !== "https://brizbuilder.local") return "/dashboard";
    if (url.pathname === "/login" || url.pathname.startsWith("/api/auth/"))
      return "/dashboard";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}

function loginPath(returnTo: string) {
  return `/login?return_to=${encodeURIComponent(returnTo)}`;
}

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const returnTo = safeReturnTo(form.get("return_to"));

  if (!email || !password) return redirectTo(request, loginPath(returnTo), "missing");

  const clientIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const throttleKey = `${email}|${clientIp}`;
  if (throttled(throttleKey))
    return redirectTo(request, loginPath(returnTo), "rate");

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return redirectTo(request, loginPath(returnTo), "config");
  }

  // signInWithPassword writes the session cookies through the SSR cookie
  // bridge. The password itself is never logged or echoed back.
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Do not leave the previous browser user's session active after a failed
    // attempt. Otherwise the page can look like the wrong account signed in.
    await supabase.auth.signOut();
    return redirectTo(request, loginPath(returnTo), "invalid");
  }

  clearThrottle(throttleKey);
  return redirectTo(request, returnTo);
}
