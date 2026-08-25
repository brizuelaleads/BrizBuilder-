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
//  2. The server reads exactly one query parameter — the exchange token. Click
//     identifiers arrive in the address bar, are read in the browser, and are
//     shown there. They are never parsed server-side, never logged, never
//     stored. The redirect carries them across untouched without reading them.
//
// If you add a searchParams read for anything but the exchange token, or a
// network call of any kind, you have broken this page.

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

  return new Response(
    renderPage(connection.scriptUrl, connection.companyName),
    {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        // Only CallRail may execute or be contacted. 'self' is deliberately
        // absent from connect-src: a page that carries click identifiers in
        // its address bar must not be able to post them back to us either.
        "Content-Security-Policy": [
          "default-src 'none'",
          "script-src 'unsafe-inline' https://cdn.callrail.com",
          "style-src 'unsafe-inline'",
          "connect-src https://*.callrail.com",
          "img-src data: https://*.callrail.com",
          "form-action 'none'",
          "base-uri 'none'",
          "frame-ancestors 'none'",
        ].join("; "),
      },
    },
  );
}

function renderPage(scriptUrl: string, companyName: string): string {
  const reported = JSON.stringify(DNI_REPORTED_PARAMS);
  const safeScript = escapeHtml(scriptUrl);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">',
    '<meta name="referrer" content="no-referrer">',
    "<title>CallRail number-swap check</title>",
    "<style>",
    ":root{color-scheme:light dark;--line:#d3dadd;--soft:#6e7c82;--ok:#2a6349;--no:#96302c}",
    'body{font:16px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif;margin:0 auto;padding:2rem 1.25rem 4rem;max-width:46rem}',
    "h1{font-size:1.4rem;margin:0 0 .25rem}",
    "p.sub{color:var(--soft);margin:0 0 2rem}",
    "section{border:1px solid var(--line);border-radius:6px;padding:1rem 1.1rem;margin-bottom:1.25rem}",
    "h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;color:var(--soft);margin:0 0 .75rem}",
    "table{border-collapse:collapse;width:100%;font-size:.9rem}",
    "td{padding:.35rem 0;vertical-align:top}",
    "td:first-child{color:var(--soft);width:11rem}",
    "code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85em;word-break:break-all}",
    ".ok{color:var(--ok);font-weight:600}",
    ".no{color:var(--no);font-weight:600}",
    "input{font:inherit;padding:.45rem .6rem;border:1px solid var(--line);border-radius:4px;width:14rem}",
    ".swap{font-size:1.5rem;font-weight:700;margin:.5rem 0}",
    ".note{font-size:.85rem;color:var(--soft)}",
    "</style>",
    "</head>",
    "<body>",
    "<h1>CallRail number-swap check</h1>",
    '<p class="sub">' +
      escapeHtml(companyName) +
      " &middot; not indexed, sends nothing to any server, and cannot create a lead or a conversion.</p>",

    "<section><h2>Tracking script</h2><table><tbody>",
    '<tr><td>Status</td><td id="script-status">checking&hellip;</td></tr>',
    "<tr><td>Source</td><td><code>" + safeScript + "</code></td></tr>",
    "</tbody></table></section>",

    "<section><h2>Number swap</h2>",
    '<p class="note">Type the number the tracker forwards to. CallRail replaces it in the page when a visit matches the tracker.</p>',
    '<p><input id="original" inputmode="tel" placeholder="(555) 555-0100" autocomplete="off"></p>',
    '<p class="swap"><a id="swap-target" href="tel:">&mdash;</a></p>',
    "<table><tbody>",
    '<tr><td>Shown now</td><td id="swap-current">&mdash;</td></tr>',
    '<tr><td>Swapped</td><td id="swap-result">waiting for a number</td></tr>',
    "</tbody></table></section>",

    "<section><h2>Attribution in the address bar</h2>",
    '<p class="note">Read from this browser and shown here. The server was not sent these and did not read them. Authorization is held in a cookie this page cannot read, and never appears below.</p>',
    '<table><tbody id="params"></tbody></table></section>',

    "<section><h2>Landing page and referrer</h2><table><tbody>",
    '<tr><td>Landing page</td><td><code id="landing"></code></td></tr>',
    '<tr><td>Referrer</td><td><code id="referrer"></code></td></tr>',
    "</tbody></table></section>",

    '<script type="text/javascript" src="' +
      safeScript +
      '" id="callrail-swap" async></' + "script>",
    '<script type="text/javascript">',
    "(function(){",
    "var REPORTED=" + reported + ";",
    "var params=new URLSearchParams(window.location.search);",
    'var rows=document.getElementById("params");var seen=0;',
    "// Allowlist only. Anything not named here is never rendered, so a",
    "// credential appended to the URL by hand still cannot be displayed.",
    "REPORTED.forEach(function(key){",
    "var value=params.get(key);if(!value)return;seen+=1;",
    'var tr=document.createElement("tr");',
    'var label=document.createElement("td");label.textContent=key;',
    'var cell=document.createElement("td");var code=document.createElement("code");',
    "// textContent, never innerHTML: the address bar is caller-controlled.",
    "code.textContent=value;cell.appendChild(code);",
    "tr.appendChild(label);tr.appendChild(cell);rows.appendChild(tr);});",
    "if(!seen){",
    'var empty=document.createElement("tr");var only=document.createElement("td");',
    'only.setAttribute("colspan","2");',
    'only.textContent="No click identifiers or UTM values in this URL. Add some and reload.";',
    "empty.appendChild(only);rows.appendChild(empty);}",
    'document.getElementById("landing").textContent=window.location.origin+window.location.pathname;',
    'document.getElementById("referrer").textContent=document.referrer||"(none)";',
    'var status=document.getElementById("script-status");',
    'var tag=document.getElementById("callrail-swap");',
    'tag.addEventListener("load",function(){status.textContent="loaded";status.className="ok";});',
    'tag.addEventListener("error",function(){status.textContent="did not load - check the company script URL";status.className="no";});',
    'var input=document.getElementById("original");',
    'var target=document.getElementById("swap-target");',
    'var current=document.getElementById("swap-current");',
    'var result=document.getElementById("swap-result");',
    'var original="";',
    'function digits(v){return (v||"").replace(/[^0-9]/g,"");}',
    'input.addEventListener("input",function(){',
    "original=input.value.trim();",
    'target.textContent=original||"\\u2014";',
    'target.setAttribute("href","tel:"+digits(original));',
    'current.textContent=original||"\\u2014";',
    'result.textContent=original?"waiting for CallRail to swap":"waiting for a number";',
    'result.className="";});',
    "// CallRail rewrites the DOM after its script initialises, so this polls",
    "// rather than reading once.",
    "window.setInterval(function(){",
    "if(!original)return;",
    "var shown=target.textContent.trim();current.textContent=shown;",
    "if(digits(shown)&&digits(shown)!==digits(original)){",
    'result.textContent="yes - replaced with "+shown;result.className="ok";',
    '}else{result.textContent="not yet - no swap for this visit";result.className="no";}',
    "},1000);",
    "})();",
    "</" + "script>",
    "</body>",
    "</html>",
  ].join("\n");
}
