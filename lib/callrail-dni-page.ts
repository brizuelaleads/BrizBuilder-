// The diagnostic page's HTML and the policy that governs it, kept out of the
// route so the parts that decide whether the test can work — element ordering,
// the bootstrap, the formatting, and now the content security policy — can be
// rendered and exercised directly in tests.
//
// Why this page is built in two stages:
//
// CallRail's swap script scans the document for supported phone-number elements
// when it initialises, and does not reliably rescan nodes added afterwards. A
// page that creates its number when someone types has already missed the scan,
// which is exactly why the first version of this page loaded the script and
// reported the attribution correctly while never swapping anything.
//
// So the destination is captured on one visit and used on the next. Entering it
// writes to sessionStorage and reloads; on the reload a synchronous inline
// script — running before the external script tag is reached — writes a
// normally formatted number and a matching tel: anchor into the DOM. By the
// time swap.js initialises, the targets it looks for are already there.
//
// The destination never leaves the browser. It is held in sessionStorage, is
// never placed in a URL, and there is no code here that could send it anywhere.
//
// Every inline block is authorized by the SHA-256 of its own bytes, computed
// from the same strings that are emitted. `unsafe-inline` appears nowhere: a
// page whose whole purpose is to host a third-party script should not also
// permit arbitrary inline execution.

/** Where the browser keeps the destination between the two stages. */
export const DNI_DESTINATION_STORAGE_KEY = "brizbuilder.dni.destination";

/** Ids the bootstrap fills and the checker watches. */
export const DNI_SWAP_LINK_ID = "dni-swap-link";
export const DNI_SWAP_TEXT_ID = "dni-swap-text";
export const DNI_BOOTSTRAP_ID = "dni-bootstrap";
export const DNI_SCRIPT_ID = "callrail-swap";

/** The only host permitted to serve script to this page. */
export const DNI_SCRIPT_ORIGIN = "https://cdn.callrail.com";

export type DniFormattedNumber = { display: string; tel: string };

/**
 * Formats a typed number the way a real site would print one.
 *
 * CallRail matches numbers written the way people write them, so a bare digit
 * string is not a fair test of the swap. North American ten-digit only, which
 * is the market the trial number will be in; anything else is refused rather
 * than guessed at, because a half-formatted number would fail the swap and look
 * like CallRail's fault.
 */
export function formatDniNumber(raw: unknown): DniFormattedNumber | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D+/gu, "");
  const national =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  if (national.startsWith("0") || national.startsWith("1")) return null;
  return {
    display: `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`,
    tel: `+1${national}`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The CSP source expression for a block of inline content.
 *
 * Hashed over exactly the bytes that go between the tags. The emitters below
 * concatenate the tag and its content in a single expression precisely so that
 * what is hashed and what is served cannot differ by a stray newline — a
 * mismatch there does not fail loudly, it silently blocks the script.
 */
export async function dniCspHash(source: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

/**
 * The synchronous bootstrap, emitted immediately before the CallRail tag.
 *
 * Deliberately tiny and dependency-free: it runs during parsing, so anything it
 * waits for — DOMContentLoaded, a module import, a fetch — would put it after
 * the scan it exists to beat. It reads one value from sessionStorage and writes
 * two elements. Nothing else.
 *
 * Kept as a string so the same source can be extracted and executed in a test
 * against a stub DOM, proving it really does create the targets rather than
 * proving only that the file mentions them.
 */
export function buildDniBootstrapSource(): string {
  return [
    "(function(){",
    "try{",
    `var raw=window.sessionStorage.getItem(${JSON.stringify(DNI_DESTINATION_STORAGE_KEY)});`,
    "if(!raw)return;",
    "var d=raw.replace(/[^0-9]/g,'');",
    "if(d.length===11&&d.charAt(0)==='1'){d=d.slice(1);}",
    "if(d.length!==10)return;",
    "if(d.charAt(0)==='0'||d.charAt(0)==='1')return;",
    "var display='('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6);",
    `var link=document.getElementById(${JSON.stringify(DNI_SWAP_LINK_ID)});`,
    `var text=document.getElementById(${JSON.stringify(DNI_SWAP_TEXT_ID)});`,
    "if(link){link.textContent=display;link.setAttribute('href','tel:+1'+d);}",
    "if(text){text.textContent=display;}",
    "document.documentElement.setAttribute('data-dni-stage','armed');",
    "}catch(e){}",
    "})();",
  ].join("");
}

/** The page's own styling. Hashed, so no inline style may be injected. */
export function buildDniStyleSource(): string {
  return [
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
    "button{font:inherit;padding:.45rem .9rem;border:1px solid var(--line);border-radius:4px;background:transparent;color:inherit;cursor:pointer}",
    ".swap{font-size:1.6rem;font-weight:700;margin:.4rem 0}",
    ".note{font-size:.85rem;color:var(--soft)}",
    '[data-dni-stage="collect"] .stage-armed{display:none}',
    '[data-dni-stage="armed"] .stage-collect{display:none}',
  ].join("");
}

/**
 * Everything that may run after CallRail has been given its chance: the
 * attribution table, the stage handling, and the swap watcher.
 *
 * Separate from the bootstrap because only the bootstrap has to beat the scan.
 * Both are hashed, so neither can be edited without the policy following.
 */
export function buildDniMainSource(reportedParams: readonly string[]): string {
  return [
    "(function(){",
    `var REPORTED=${JSON.stringify(reportedParams)};`,
    `var STORAGE_KEY=${JSON.stringify(DNI_DESTINATION_STORAGE_KEY)};`,
    "var params=new URLSearchParams(window.location.search);",

    'var rows=document.getElementById("params");var seen=0;',
    "REPORTED.forEach(function(key){",
    "var value=params.get(key);if(!value)return;seen+=1;",
    'var tr=document.createElement("tr");',
    'var label=document.createElement("td");label.textContent=key;',
    'var cell=document.createElement("td");var code=document.createElement("code");',
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
    `var tag=document.getElementById(${JSON.stringify(DNI_SCRIPT_ID)});`,
    'function ok(){status.textContent="loaded";status.className="ok";}',
    'tag.addEventListener("load",ok);',
    'tag.addEventListener("error",function(){status.textContent="did not load - check the company script URL";status.className="no";});',

    'var input=document.getElementById("destination");',
    'var arm=document.getElementById("arm");',
    'var error=document.getElementById("destination-error");',
    "function digits(v){return (v||'').replace(/[^0-9]/g,'');}",
    "function national(v){var d=digits(v);",
    "if(d.length===11&&d.charAt(0)==='1'){d=d.slice(1);}return d;}",
    "if(arm){arm.addEventListener('click',function(){",
    "var d=national(input.value);",
    "if(d.length!==10||d.charAt(0)==='0'||d.charAt(0)==='1'){",
    'error.textContent="Enter a ten-digit US number, the one the tracker forwards to.";',
    'error.className="note no";return;}',
    "try{window.sessionStorage.setItem(STORAGE_KEY,d);}catch(e){",
    'error.textContent="This browser is blocking session storage, so the number cannot be placed before the script runs.";',
    'error.className="note no";return;}',
    "window.location.reload();});}",

    `var link=document.getElementById(${JSON.stringify(DNI_SWAP_LINK_ID)});`,
    'var prepared=document.getElementById("prepared");',
    'var current=document.getElementById("swap-current");',
    'var result=document.getElementById("swap-result");',
    "var original='';",
    "try{original=window.sessionStorage.getItem(STORAGE_KEY)||'';}catch(e){}",
    "if(original&&link){",
    'prepared.textContent="yes - written by the inline bootstrap";',
    'prepared.className="ok";',
    "window.setInterval(function(){",
    "var shown=(link.textContent||'').trim();",
    "current.textContent=shown;",
    "if(digits(shown)&&digits(shown)!==digits(original)){",
    'result.textContent="yes - replaced with "+shown;result.className="ok";',
    '}else{result.textContent="not yet - no swap for this visit";result.className="no";}',
    "},1000);}",

    'var reset=document.getElementById("reset");',
    "if(reset){reset.addEventListener('click',function(){",
    "try{window.sessionStorage.removeItem(STORAGE_KEY);}catch(e){}",
    "window.location.reload();});}",
    "})();",
  ].join("\n");
}

/**
 * The policy for one rendered page.
 *
 * Each inline block is admitted by its own digest and nothing else. The
 * external script keeps a separate, narrower permission: a bare host, so only
 * CallRail's CDN may serve executable code, and a hash cannot be used to smuggle
 * in a different origin.
 */
export type DniScriptHashes = {
  bootstrap: string;
  main: string;
  style: string;
};

export function buildDniCsp(hashes: DniScriptHashes): string {
  return [
    "default-src 'none'",
    // Two exact digests plus one exact origin. No 'unsafe-inline': with a hash
    // present browsers ignore it anyway, and stating it would misdescribe the
    // policy to anyone reading the header.
    `script-src '${hashes.bootstrap}' '${hashes.main}' ${DNI_SCRIPT_ORIGIN}`,
    `style-src '${hashes.style}'`,
    "connect-src https://*.callrail.com",
    "img-src data: https://*.callrail.com",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export type DniPageRender = {
  html: string;
  contentSecurityPolicy: string;
};

/**
 * The page and the policy that admits it, built together.
 *
 * Element order is load-bearing and not merely tidy: the swap targets appear
 * before the bootstrap, the bootstrap before the CallRail tag, and the CallRail
 * tag carries no `async` so its execution cannot be hoisted ahead of the inline
 * script that prepares the DOM for it.
 */
export async function renderDniPage(
  scriptUrl: string,
  companyName: string,
  // Injected rather than imported: this module is unit-tested under node's
  // type stripping, where a relative specifier without an extension does not
  // resolve. The allowlist keeps its single definition next to the auth
  // fields it is checked against.
  reportedParams: readonly string[],
): Promise<DniPageRender> {
  const safeScript = escapeHtml(scriptUrl);
  const bootstrapSource = buildDniBootstrapSource();
  const styleSource = buildDniStyleSource();
  const mainSource = buildDniMainSource(reportedParams);

  const [bootstrap, main, style] = await Promise.all([
    dniCspHash(bootstrapSource),
    dniCspHash(mainSource),
    dniCspHash(styleSource),
  ]);

  const html = [
    "<!doctype html>",
    '<html lang="en" data-dni-stage="collect">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">',
    '<meta name="referrer" content="no-referrer">',
    "<title>CallRail number-swap check</title>",
    // Tag and content in one expression: what is hashed is what is served.
    "<style>" + styleSource + "</style>",
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

    // Stage one: capture the destination and reload. Nothing is sent anywhere.
    '<div class="stage-collect">',
    '<p class="note">Type the number the tracker forwards to. It is kept in this browser tab only &mdash; it is never sent to BrizBuilder, and reloading is deliberate: the number has to be on the page <em>before</em> CallRail\'s script runs, or it has nothing to swap.</p>',
    '<p><input id="destination" inputmode="tel" placeholder="(555) 555-0100" autocomplete="off"> <button id="arm" type="button">Set number and reload</button></p>',
    '<p class="note" id="destination-error"></p>',
    "</div>",

    // Stage two: the targets the bootstrap fills, present in the document
    // before the bootstrap and long before CallRail's script.
    '<div class="stage-armed">',
    '<p class="swap"><a id="' + DNI_SWAP_LINK_ID + '" href="tel:">&mdash;</a></p>',
    '<p class="note">Plain text on the page: <span id="' +
      DNI_SWAP_TEXT_ID +
      '">&mdash;</span></p>',
    "<table><tbody>",
    '<tr><td>Placed before swap.js</td><td id="prepared">&mdash;</td></tr>',
    '<tr><td>Shown now</td><td id="swap-current">&mdash;</td></tr>',
    '<tr><td>Swapped</td><td id="swap-result">watching&hellip;</td></tr>',
    "</tbody></table>",
    '<p><button id="reset" type="button">Use a different number</button></p>',
    "</div>",
    "</section>",

    "<section><h2>Attribution in the address bar</h2>",
    '<p class="note">Read from this browser and shown here. The server was not sent these and did not read them. Authorization is held in a cookie this page cannot read, and never appears below.</p>',
    '<table><tbody id="params"></tbody></table></section>',

    "<section><h2>Landing page and referrer</h2><table><tbody>",
    '<tr><td>Landing page</td><td><code id="landing"></code></td></tr>',
    '<tr><td>Referrer</td><td><code id="referrer"></code></td></tr>',
    "</tbody></table></section>",

    // ---- ORDER BELOW THIS LINE IS LOAD-BEARING ----
    // 1. the bootstrap, synchronous, filling the targets declared above
    '<script type="text/javascript" id="' +
      DNI_BOOTSTRAP_ID +
      '">' +
      bootstrapSource +
      "</" +
      "script>",
    // 2. CallRail, with no async: its execution must not be hoisted ahead of
    //    the inline script that prepared the DOM it is about to scan.
    '<script type="text/javascript" src="' +
      safeScript +
      '" id="' +
      DNI_SCRIPT_ID +
      '"></' +
      "script>",
    // 3. everything else, which may run whenever
    '<script type="text/javascript">' + mainSource + "</" + "script>",
    "</body>",
    "</html>",
  ].join("\n");

  return {
    html,
    contentSecurityPolicy: buildDniCsp({ bootstrap, main, style }),
  };
}
