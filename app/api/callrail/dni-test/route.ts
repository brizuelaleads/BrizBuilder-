import { renderDniPage } from "../../../../lib/callrail-dni-page";
import {
  DNI_EXCHANGE_PARAM,
  DNI_NO_STORE_HEADERS,
  DNI_REPORTED_PARAMS,
  DNI_SESSION_TTL_MS,
  buildDniCookie,
  cleanDniRedirect,
  clearDniCookie,
  isCallRailScriptUrl,
  normalizeCallRailScriptUrl,
  readDniCookie,
} from "../../../../lib/callrail-dni";
import {
  signDniCredential,
  verifyDniCredential,
} from "../../../../lib/callrail";
import { getSupabaseAdminClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

// A diagnostic page for proving Dynamic Number Insertion works, and nothing
// else.
//
// Authorization never appears in a URL that survives. A minted link carries a
// two-minute token exactly once: the first request trades it for an HttpOnly
// cookie and redirects to the same page with the token stripped. From then on
// the credential lives only in a cookie header —
//
//   * CallRail's script runs on this page and cannot read it (HttpOnly)
//   * it is not in window.location, so nothing can copy it out of the bar
//   * it is not in the history entry the browser keeps
//   * Referrer-Policy: no-referrer means it cannot leak to the CDN
//   * SameSite=Strict means nothing off-site can cause it to be sent
//
// Two further properties this file has to keep:
//
//  1. It never captures anything. No form, no fetch, no beacon. Nothing here
//     can create a lead or report a conversion, because there is no code that
//     could.
//  2. The destination number the operator types is never sent here. It lives
//     in sessionStorage in their browser, because the page has to place it in
//     the DOM before CallRail's script scans, and a server round trip would
//     both miss that window and put a phone number in a log.
//  3. The server reads exactly one query parameter — the exchange token. Click
//     identifiers arrive in the address bar, are read in the browser, and are
//     shown there. They are never parsed server-side, never logged, never
//     stored. The redirect carries them across untouched without reading them.
//
// If you add a searchParams read for anything but the exchange token, or a
// network call of any kind, you have broken this page.

// Every response this file produces carries these: the exchange, the redirect,
// the rendered page and every refusal. A credential-authorized page carrying
// click identifiers must never be written down by a browser, a proxy or a
// back-forward cache.
const BASE_HEADERS = DNI_NO_STORE_HEADERS;

/** One answer for a forged token, an expired one, and an unknown client. */
function notFound(): Response {
  return new Response("Not found.", {
    status: 404,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      // A rejected credential is cleared rather than left to fail repeatedly.
      "Set-Cookie": clearDniCookie(),
    },
  });
}

type Connection = { scriptUrl: string; companyName: string };

/**
 * Loads the connection a credential authorizes.
 *
 * Scoped to both halves of the tenant the claim carries. A credential names an
 * organization and a client, and the row has to match both — an id on its own
 * is not authority to read a connection.
 */
async function loadConnection(
  organizationId: string,
  clientId: string,
): Promise<Connection | null> {
  const result = await getSupabaseAdminClient()
    .from("provider_connections")
    .select("public_config")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .eq("provider", "callrail")
    .maybeSingle();
  if (result.error) return null;
  const config =
    result.data?.public_config && typeof result.data.public_config === "object"
      ? (result.data.public_config as Record<string, unknown>)
      : {};
  // Checked at the point of use, not merely when it was stored: anything
  // reaching a script src executes with this page's authority.
  if (!isCallRailScriptUrl(config.scriptUrl)) return null;
  return {
    scriptUrl: normalizeCallRailScriptUrl(String(config.scriptUrl)),
    companyName:
      typeof config.companyName === "string"
        ? config.companyName
        : "this company",
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // The only query parameter this file is permitted to read.
  const exchangeToken = url.searchParams.get(DNI_EXCHANGE_PARAM);

  if (exchangeToken) {
    const claim = await verifyDniCredential(exchangeToken);
    if (!claim) return notFound();
    if (!(await loadConnection(claim.organizationId, claim.clientId)))
      return notFound();

    // Trade the link for a cookie and send the browser to the same page with
    // the credential stripped. The attribution parameters ride along untouched
    // — without them there is no swap to observe — but they are carried, never
    // read.
    // The session credential carries the same tenant pair and its own signed
    // deadline, checked on the server every time it is presented.
    const session = await signDniCredential(
      claim.organizationId,
      claim.clientId,
      DNI_SESSION_TTL_MS,
    );
    return new Response(null, {
      status: 303,
      headers: {
        ...BASE_HEADERS,
        Location: cleanDniRedirect(request.url),
        "Set-Cookie": buildDniCookie(session, DNI_SESSION_TTL_MS / 1000),
      },
    });
  }

  const claim = await verifyDniCredential(readDniCookie(request.headers.get("cookie")));
  if (!claim) return notFound();
  const connection = await loadConnection(
    claim.organizationId,
    claim.clientId,
  );
  if (!connection) return notFound();

  // The policy is built from the digests of the very strings the page emits,
  // so a change to any inline block moves its hash and the header with it.
  // Nothing here can drift from what is served, because both come from one
  // call.
  const page = await renderDniPage(
    connection.scriptUrl,
    connection.companyName,
    DNI_REPORTED_PARAMS,
  );

  return new Response(page.html, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      // Each inline block is admitted by its own SHA-256 and the external
      // script by one exact origin. 'unsafe-inline' appears nowhere, and
      // 'self' is absent from connect-src: a page that carries click
      // identifiers in its address bar must not be able to post them back to
      // us either.
      "Content-Security-Policy": page.contentSecurityPolicy,
    },
  });
}
