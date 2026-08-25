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

/** The origin the page's own script tag points at. */
export const DNI_SCRIPT_ORIGIN = "https://cdn.callrail.com";

/**
 * Every host permitted to serve executable code to this page. Exactly two.
 *
 * swap.js is served from the CDN and then loads further resources through its
 * own `getScript`, which reaches js.callrail.com. Without that second host the
 * script loads and then quietly fails to do the one thing it is here for.
 *
 * Named in full rather than covered by a wildcard: `https://*.callrail.com`
 * would admit every present and future CallRail subdomain, which is a larger
 * grant than the evidence supports. Two exact hosts can be checked against the
 * script that actually needs them.
 */
export const DNI_SCRIPT_HOSTS = [
  DNI_SCRIPT_ORIGIN,
  "https://js.callrail.com",
] as const;

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

/** CallRail's globals. Present once its script has executed, absent if it did
 * not load, was blocked, or failed. Checked rather than inferred from a load
 * event: the script is a classic one placed before this check, so its load
 * event has already fired by the time any later listener could attach — which
 * is why the status previously sat at "checking…" forever. */
export const DNI_CALLRAIL_GLOBALS = ["CallTrk", "CallTrkSwap"] as const;

/**
 * Ten national digits, or nothing.
 *
 * Every comparison in the swap check runs on this, so a number that has only
 * been reformatted — dots for dashes, spaces added, a +1 gained — normalizes to
 * the same value and cannot be mistaken for a replacement.
 */
export function normalizeDniDigits(value: unknown): string {
  if (typeof value !== "string") return "";
  const digits = value.replace(/\D+/gu, "");
  const national =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return national.length === 10 ? national : "";
}

export type DniSwapState = {
  /** Whether CallRail's script actually executed. */
  loaded: boolean;
  /** The destination, normalized. */
  destination: string;
  /** The link's visible text, normalized. */
  text: string;
  /** The link's tel: target, normalized. */
  href: string;
};

export type DniSwapVerdict = { swapped: boolean; reason: string };

/**
 * Decides whether a swap really happened.
 *
 * The previous check asked only whether the visible digits differed from the
 * destination, and reported success when they did not — it announced a swap
 * for (254) 382-3256 against a destination of (254) 382-3256, while CallRail
 * had not even finished loading. Every clause below exists because that
 * verdict has to be earned:
 *
 *  - CallRail must have loaded, or nothing could have swapped anything.
 *  - Both the visible text and the tel: target must carry a number, since
 *    CallRail rewrites both and half a rewrite is not a swap.
 *  - The two must agree, or the page is in an inconsistent state rather than a
 *    swapped one.
 *  - And the result must differ from the destination, compared on normalized
 *    digits so reformatting alone can never qualify.
 */
export function evaluateDniSwap(state: DniSwapState): DniSwapVerdict {
  if (!state.loaded)
    return { swapped: false, reason: "CallRail's script has not loaded" };
  if (!state.text || !state.href)
    return { swapped: false, reason: "no usable number on the page yet" };
  if (state.text !== state.href)
    return {
      swapped: false,
      reason: "the visible number and the tel: link disagree",
    };
  if (!state.destination)
    return { swapped: false, reason: "no destination to compare against" };
  if (state.text === state.destination)
    return { swapped: false, reason: "still the destination number" };
  return { swapped: true, reason: "replaced with a different number" };
}

/**
 * The same rule as JavaScript for the page.
 *
 * Emitted as a string so a test can execute this exact source and check it
 * against `evaluateDniSwap`, rather than trusting two implementations to stay
 * in step by inspection.
 */
export function buildDniSwapEvaluatorSource(): string {
  return [
    "function evaluateSwap(state){",
    "if(!state.loaded)return{swapped:false,reason:\"CallRail's script has not loaded\"};",
    'if(!state.text||!state.href)return{swapped:false,reason:"no usable number on the page yet"};',
    'if(state.text!==state.href)return{swapped:false,reason:"the visible number and the tel: link disagree"};',
    'if(!state.destination)return{swapped:false,reason:"no destination to compare against"};',
    'if(state.text===state.destination)return{swapped:false,reason:"still the destination number"};',
    'return{swapped:true,reason:"replaced with a different number"};',
    "}",
  ].join("");
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
    `var GLOBALS=${JSON.stringify(DNI_CALLRAIL_GLOBALS)};`,
    "var params=new URLSearchParams(window.location.search);",

    // The shared rule, byte-identical to the exported one.
    buildDniSwapEvaluatorSource(),
    "function norm(v){var d=(v||'').replace(/[^0-9]/g,'');",
    "if(d.length===11&&d.charAt(0)==='1'){d=d.slice(1);}",
    "return d.length===10?d:'';}",
    "function telDigits(a){var h=(a&&a.getAttribute('href'))||'';",
    "return norm(h.replace(/^tel:/i,''));}",
    "function callrailLoaded(){for(var i=0;i<GLOBALS.length;i++){",
    "if(typeof window[GLOBALS[i]]!=='undefined')return true;}return false;}",

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

    'var input=document.getElementById("destination");',
    'var arm=document.getElementById("arm");',
    'var error=document.getElementById("destination-error");',
    "if(arm){arm.addEventListener('click',function(){",
    "var d=norm(input.value);",
    "if(!d){",
    'error.textContent="Enter a ten-digit US number, the one the tracker forwards to.";',
    'error.className="note no";return;}',
    "try{window.sessionStorage.setItem(STORAGE_KEY,d);}catch(e){",
    'error.textContent="This browser is blocking session storage, so the number cannot be placed before the script runs.";',
    'error.className="note no";return;}',
    "window.location.reload();});}",

    `var link=document.getElementById(${JSON.stringify(DNI_SWAP_LINK_ID)});`,
    'var status=document.getElementById("script-status");',
    'var prepared=document.getElementById("prepared");',
    'var destCell=document.getElementById("swap-destination");',
    'var textCell=document.getElementById("swap-text-digits");',
    'var hrefCell=document.getElementById("swap-href-digits");',
    'var result=document.getElementById("swap-result");',
    'var reason=document.getElementById("swap-reason");',
    "var stored='';",
    "try{stored=window.sessionStorage.getItem(STORAGE_KEY)||'';}catch(e){}",
    "var destination=norm(stored);",

    "function tick(){",
    "var loaded=callrailLoaded();",
    'status.textContent=loaded?"loaded":"not loaded - blocked, unreachable, or still fetching";',
    'status.className=loaded?"ok":"no";',
    "if(!link)return;",
    "var text=norm(link.textContent);",
    "var href=telDigits(link);",
    'destCell.textContent=destination||"(none)";',
    'textCell.textContent=text||"(none)";',
    'hrefCell.textContent=href||"(none)";',
    'prepared.textContent=destination?"yes - written by the inline bootstrap":"no";',
    'prepared.className=destination?"ok":"no";',
    "var verdict=evaluateSwap({loaded:loaded,destination:destination,text:text,href:href});",
    'result.textContent=verdict.swapped?"yes":"no";',
    'result.className=verdict.swapped?"ok":"no";',
    "reason.textContent=verdict.reason;",
    "}",
    "tick();",
    "window.setInterval(tick,1000);",

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
    // Two exact digests plus two exact hosts. No 'unsafe-inline' — with a hash
    // present browsers ignore it anyway, and stating it would misdescribe the
    // policy — and no 'strict-dynamic', which would let anything swap.js loads
    // go on to load anything else.
    `script-src '${hashes.bootstrap}' '${hashes.main}' ${DNI_SCRIPT_HOSTS.join(" ")}`,
    // Hash only, no host: swap.js injects a stylesheet that hides .phoneswap
    // elements, and blocking it is deliberate. This page uses no such element,
    // the rule is cosmetic, and the narrower policy is worth more than the
    // rule is.
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
    // data-calltrk-noswap excludes this element and everything inside it from
    // CallRail's scan. Without it the report is itself a swap target: the
    // destination is printed here as a plain number, CallRail rewrites it to
    // the tracking number like any other occurrence on the page, and the
    // reference the verdict is read against silently becomes the thing it was
    // supposed to be compared with. The swap targets above are deliberately
    // left scannable; only the readout is protected.
    '<table data-calltrk-noswap><tbody>',
    '<tr><td>Placed before swap.js</td><td id="prepared">&mdash;</td></tr>',
    '<tr><td>Destination</td><td id="swap-destination">&mdash;</td></tr>',
    '<tr><td>Visible text</td><td id="swap-text-digits">&mdash;</td></tr>',
    '<tr><td>tel: link</td><td id="swap-href-digits">&mdash;</td></tr>',
    '<tr><td>Swapped</td><td id="swap-result">watching&hellip;</td></tr>',
    '<tr><td>Why</td><td id="swap-reason">&mdash;</td></tr>',
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
