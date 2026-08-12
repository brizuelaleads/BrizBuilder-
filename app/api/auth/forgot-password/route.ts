import { requestPasswordResetEmail } from "../../../../lib/system-auth";

export const dynamic = "force-dynamic";

const MAX_PASSWORD_RESET_REQUESTS = 5;
const WINDOW_MS = 10 * 60_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const key = `${email || "blank"}|${clientIp(request)}`;

  if (!throttled(key)) {
    try {
      await requestPasswordResetEmail(email, request);
    } catch {
      // Keep the response generic so this route never reveals account existence
      // or provider configuration details.
    }
  }

  return redirectTo(request, "/forgot-password?sent=1");
}

function throttled(key: string): boolean {
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || bucket.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_PASSWORD_RESET_REQUESTS;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "ipless"
  );
}

function redirectTo(request: Request, path: string) {
  return Response.redirect(new URL(path, request.url), 303);
}
