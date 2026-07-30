import { getChatGPTUser } from "../../chatgpt-auth";
import { executeCrmAction, getCrmBootstrap, type CrmAction } from "../../../db/runtime-crm";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseRuntimeEnv } from "../../../lib/supabase/env";

export const dynamic = "force-dynamic";

// A missing Origin used to be treated as same-origin, which let a
// cross-site form post through. Browsers send Origin on every POST and also
// send Sec-Fetch-Site, so require positive proof from one of them.
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === new URL(request.url).host;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "none";
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
  return Response.json({ error: message }, { status });
}

async function verifyCurrentPassword(email: string, password: unknown) {
  if (typeof password !== "string" || !password || password.length > 200) {
    throw new Error("Enter your current password.");
  }
  const { url, anonKey } = getSupabaseRuntimeEnv();
  if (!url || !anonKey) {
    throw new Error("Password confirmation is unavailable. Try again later.");
  }
  const verifier = createSupabaseClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await verifier.auth.signInWithPassword({
    email,
    password,
  });
  if (
    error ||
    data.user?.email?.trim().toLowerCase() !== email.trim().toLowerCase()
  ) {
    throw new Error("Your current password is incorrect.");
  }
}
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const data = await getCrmBootstrap(user);
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 512_000) return Response.json({ error: "Request is too large." }, { status: 413 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }

  try {
    const input = (await request.json()) as CrmAction;
    if (input.action === "delete_client") {
      await verifyCurrentPassword(user.email, input.password);
    }
    const safeInput = { ...input };
    delete safeInput.password;
    const result = await executeCrmAction(user, safeInput);
    return Response.json({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
