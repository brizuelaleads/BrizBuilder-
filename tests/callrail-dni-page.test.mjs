import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DNI_BOOTSTRAP_ID,
  DNI_CALLRAIL_GLOBALS,
  DNI_DESTINATION_STORAGE_KEY,
  DNI_SCRIPT_ID,
  DNI_SCRIPT_HOSTS,
  DNI_SCRIPT_ORIGIN,
  DNI_SWAP_LINK_ID,
  DNI_SWAP_TEXT_ID,
  buildDniBootstrapSource,
  buildDniMainSource,
  buildDniSwapEvaluatorSource,
  evaluateDniSwap,
  formatDniNumber,
  normalizeDniDigits,
  renderDniPage,
} from "../lib/callrail-dni-page.ts";
import { DNI_REPORTED_PARAMS } from "../lib/callrail-dni.ts";

const SCRIPT_URL =
  "https://cdn.callrail.com/companies/795888347/929ac02ed41ec3b0eb17/12/swap.js";
const rendered = await renderDniPage(
  SCRIPT_URL,
  "LB Marketing",
  DNI_REPORTED_PARAMS,
);
const html = rendered.html;
const csp = rendered.contentSecurityPolicy;

/** The exact text between an inline element's tags, as the browser sees it. */
function inlineBody(source, openTag, closeTag) {
  const start = source.indexOf(openTag);
  if (start < 0) return null;
  const from = start + openTag.length;
  const to = source.indexOf(closeTag, from);
  return to < 0 ? null : source.slice(from, to);
}

/** The CSP source expression a browser would compute for that text. */
function cspHashOf(body) {
  return `sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`;
}

/** The directive's own source list, without the neighbouring directives. */
function directive(policy, name) {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(name + " "));
  return found ?? null;
}

// CallRail's swap script scans for phone-number elements when it initialises
// and does not reliably rescan later mutations. Everything below exists to
// prove the targets are in the document, populated, before that scan.

// --------------------------------------------------------------- ordering

test("the swap targets are declared before the bootstrap that fills them", () => {
  const link = html.indexOf(`id="${DNI_SWAP_LINK_ID}"`);
  const text = html.indexOf(`id="${DNI_SWAP_TEXT_ID}"`);
  const bootstrap = html.indexOf(`id="${DNI_BOOTSTRAP_ID}"`);
  assert.ok(link > -1 && text > -1 && bootstrap > -1, "all three exist");
  assert.ok(link < bootstrap, "the tel: anchor is parsed before the bootstrap");
  assert.ok(text < bootstrap, "the text target is parsed before the bootstrap");
});

test("the bootstrap runs before the CallRail script tag", () => {
  const bootstrap = html.indexOf(`id="${DNI_BOOTSTRAP_ID}"`);
  const callrail = html.indexOf(`id="${DNI_SCRIPT_ID}"`);
  assert.ok(bootstrap > -1 && callrail > -1);
  assert.ok(
    bootstrap < callrail,
    "the inline bootstrap precedes the external script",
  );
});

test("the CallRail tag carries no async, so its order cannot be hoisted", () => {
  // With async the browser may execute the external script as soon as it
  // arrives — potentially before an inline script that appears earlier in the
  // document has run. Ordering only holds if it is a plain script.
  const tag = html.slice(
    html.lastIndexOf("<script", html.indexOf(`id="${DNI_SCRIPT_ID}"`)),
    html.indexOf(`id="${DNI_SCRIPT_ID}"`) + 60,
  );
  assert.equal(/\basync\b/.test(tag), false, "no async on the CallRail tag");
  assert.equal(/\bdefer\b/.test(tag), false, "no defer either");
  assert.match(tag, /src="https:\/\/cdn\.callrail\.com\//);
});

test("the bootstrap is inline, not a fetched resource", () => {
  // Anything it had to wait for would put it after the scan it exists to beat.
  const open = html.indexOf(`<script type="text/javascript" id="${DNI_BOOTSTRAP_ID}">`);
  assert.ok(open > -1, "the bootstrap is an inline script element");
  const tag = html.slice(open, open + 120);
  assert.equal(/\bsrc=/.test(tag), false, "the bootstrap has no src");
  assert.equal(/\basync\b|\bdefer\b/.test(tag), false);
});

// ------------------------------------------------ the bootstrap, executed

/** The smallest DOM the bootstrap touches. */
function stubDom(stored) {
  const made = {};
  const element = (id) => {
    if (!made[id]) {
      made[id] = { id, textContent: "", attributes: {} };
      made[id].setAttribute = (name, value) => {
        made[id].attributes[name] = value;
      };
    }
    return made[id];
  };
  const root = { attributes: {} };
  root.setAttribute = (name, value) => {
    root.attributes[name] = value;
  };
  return {
    elements: made,
    root,
    window: {
      sessionStorage: {
        getItem: (key) =>
          key === DNI_DESTINATION_STORAGE_KEY ? (stored ?? null) : null,
      },
    },
    document: { getElementById: element, documentElement: root },
  };
}

function runBootstrap(stored) {
  const dom = stubDom(stored);
  // The exact source the page ships, executed rather than pattern-matched.
  new Function("window", "document", buildDniBootstrapSource())(
    dom.window,
    dom.document,
  );
  return dom;
}

test("the bootstrap creates a formatted number and a matching tel: link", () => {
  const dom = runBootstrap("8125550100");
  const link = dom.elements[DNI_SWAP_LINK_ID];
  const text = dom.elements[DNI_SWAP_TEXT_ID];
  assert.ok(link, "the tel: anchor was looked up");
  // Written the way a real site prints a number, which is what CallRail scans
  // for — a bare digit string would not be a fair test of the swap.
  assert.equal(link.textContent, "(812) 555-0100");
  assert.equal(link.attributes.href, "tel:+18125550100");
  assert.equal(text.textContent, "(812) 555-0100");
  // And it marks the document so the page can show the right stage.
  assert.equal(dom.root.attributes["data-dni-stage"], "armed");
});

test("the bootstrap accepts a number typed the way people type one", () => {
  for (const typed of [
    "8125550100",
    "(812) 555-0100",
    "812-555-0100",
    "812.555.0100",
    "+1 812 555 0100",
    "18125550100",
    "  812 555 0100  ",
  ]) {
    const dom = runBootstrap(typed);
    assert.equal(
      dom.elements[DNI_SWAP_LINK_ID].textContent,
      "(812) 555-0100",
      typed,
    );
    assert.equal(
      dom.elements[DNI_SWAP_LINK_ID].attributes.href,
      "tel:+18125550100",
      typed,
    );
  }
});

test("with nothing stored the bootstrap leaves the page in the collect stage", () => {
  const dom = runBootstrap(null);
  assert.equal(dom.elements[DNI_SWAP_LINK_ID], undefined, "nothing was touched");
  assert.equal(dom.root.attributes["data-dni-stage"], undefined);
});

test("the bootstrap refuses anything that is not a usable number", () => {
  for (const bad of ["", "555", "12345678901234", "0125550100", "1125550100", "abcdefghij"]) {
    const dom = runBootstrap(bad);
    assert.equal(
      dom.root.attributes["data-dni-stage"],
      undefined,
      `${bad} must not arm the page`,
    );
  }
});

test("the bootstrap never throws, whatever storage returns", () => {
  // A browser blocking storage throws on access; the page must still render.
  const hostile = {
    window: {
      sessionStorage: {
        getItem() {
          throw new Error("blocked");
        },
      },
    },
    document: {
      getElementById: () => null,
      documentElement: { setAttribute() {} },
    },
  };
  assert.doesNotThrow(() =>
    new Function("window", "document", buildDniBootstrapSource())(
      hostile.window,
      hostile.document,
    ),
  );
});

// ------------------------------------------------------- formatter parity

test("the inline bootstrap and the exported formatter agree", () => {
  // Two implementations of one rule, so they are checked against each other
  // rather than trusted to stay in step.
  for (const input of [
    "8125550100",
    "(812) 555-0100",
    "+1 812 555 0100",
    "18125550100",
    "555",
    "",
    "0125550100",
    "1125550100",
    "81255501001234",
  ]) {
    const expected = formatDniNumber(input);
    const dom = runBootstrap(input);
    const link = dom.elements[DNI_SWAP_LINK_ID];
    if (expected === null) {
      assert.equal(dom.root.attributes["data-dni-stage"], undefined, input);
    } else {
      assert.equal(link.textContent, expected.display, input);
      assert.equal(link.attributes.href, `tel:${expected.tel}`, input);
    }
  }
});

test("the formatter refuses what it cannot format rather than guessing", () => {
  for (const bad of [null, undefined, 42, {}, "", "555", "0125550100"]) {
    assert.equal(formatDniNumber(bad), null, String(bad));
  }
  assert.deepEqual(formatDniNumber("8125550100"), {
    display: "(812) 555-0100",
    tel: "+18125550100",
  });
});

// ------------------------------------------------------------- guarantees

test("the destination never leaves the browser", () => {
  // Held in sessionStorage, never in a URL, and there is nothing on the page
  // that could transmit it.
  assert.ok(html.includes("sessionStorage"));
  for (const forbidden of [
    "fetch(",
    "XMLHttpRequest",
    "sendBeacon",
    "<form",
    "navigator.send",
    "new Image(",
    "localStorage",
    "document.cookie",
  ]) {
    assert.equal(html.includes(forbidden), false, `page must not contain ${forbidden}`);
  }
  // The bootstrap in particular reads one key and writes two elements.
  const bootstrap = buildDniBootstrapSource();
  assert.ok(bootstrap.includes(DNI_DESTINATION_STORAGE_KEY));
  assert.equal(/fetch|XMLHttpRequest|sendBeacon|cookie/.test(bootstrap), false);
});

test("the page cannot create a lead or report a conversion", () => {
  for (const forbidden of [
    "dispatchMetaConversion",
    "/api/crm",
    "website-leads",
    "fbq(",
    "gtag(",
  ]) {
    assert.equal(html.includes(forbidden), false, forbidden);
  }
});

test("attribution values are rendered as text, never as markup", () => {
  assert.ok(html.includes("code.textContent=value"));
  // What matters is that nothing is ever assigned to innerHTML. The word
  // itself appears in a comment explaining exactly that, so match the
  // assignment rather than the mention.
  assert.equal(/\.innerHTML\s*=/.test(html), false, "nothing writes innerHTML");
  assert.equal(/insertAdjacentHTML|document\.write/.test(html), false);
});

test("the page still declares itself unindexable", () => {
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

// ------------------------------------------------------------------- CSP

test("the bootstrap is authorized by the SHA-256 of its own served bytes", () => {
  // The whole point: hash what the browser will actually execute, taken out of
  // the rendered response rather than from the builder that produced it.
  const body = inlineBody(
    html,
    `<script type="text/javascript" id="${DNI_BOOTSTRAP_ID}">`,
    "</script>",
  );
  assert.ok(body, "the bootstrap body was found in the response");
  assert.ok(body.includes("sessionStorage"), "and it is the real bootstrap");

  const expected = cspHashOf(body);
  const scriptSrc = directive(csp, "script-src");
  assert.ok(scriptSrc, "script-src is present");
  assert.ok(
    scriptSrc.includes(`'${expected}'`),
    `script-src must carry ${expected}\nactual: ${scriptSrc}`,
  );
});

test("every inline block in the response is covered by a hash", () => {
  const scriptSrc = directive(csp, "script-src");
  const styleSrc = directive(csp, "style-src");

  const bootstrap = inlineBody(
    html,
    `<script type="text/javascript" id="${DNI_BOOTSTRAP_ID}">`,
    "</script>",
  );
  const main = inlineBody(html, '<script type="text/javascript">', "</script>");
  const style = inlineBody(html, "<style>", "</style>");
  assert.ok(bootstrap && main && style, "all three inline blocks were found");
  assert.notEqual(bootstrap, main, "they really are different blocks");

  assert.ok(scriptSrc.includes(`'${cspHashOf(bootstrap)}'`), "bootstrap hashed");
  assert.ok(scriptSrc.includes(`'${cspHashOf(main)}'`), "main script hashed");
  assert.ok(styleSrc.includes(`'${cspHashOf(style)}'`), "style hashed");
});

test("no inline execution is permitted by blanket allowance", () => {
  assert.equal(
    csp.includes("unsafe-inline"),
    false,
    `unsafe-inline must not appear\n${csp}`,
  );
  assert.equal(csp.includes("unsafe-eval"), false);
  assert.equal(csp.includes("unsafe-hashes"), false);
  // Inline event handlers would need 'unsafe-hashes'; the page uses none.
  // Checked against markup only: an event handler can only be an attribute,
  // and a script body may legitimately contain things like `var only=`.
  const markup = html
    .replace(/<script[\s\S]*?<\/script>/gi, "<script></script>")
    .replace(/<style[\s\S]*?<\/style>/gi, "<style></style>");
  assert.equal(
    /\son[a-z]+\s*=/i.test(markup),
    false,
    "no inline event handlers in markup",
  );
});

/** The host tokens in a directive — everything that is not a quoted keyword. */
function hostsIn(sourceList) {
  return sourceList
    .split(/\s+/)
    .slice(1)
    .filter((token) => token && !token.startsWith("'"));
}

test("script may come from exactly two CallRail hosts and nowhere else", () => {
  const scriptSrc = directive(csp, "script-src");
  assert.deepEqual(
    hostsIn(scriptSrc),
    ["https://cdn.callrail.com", "https://js.callrail.com"],
    `exactly two hosts\nactual: ${scriptSrc}`,
  );
  // swap.js is served from the first and reaches the second through its own
  // getScript; without that, it loads and then silently does nothing.
  assert.deepEqual(
    [...DNI_SCRIPT_HOSTS],
    ["https://cdn.callrail.com", "https://js.callrail.com"],
  );
  assert.equal(DNI_SCRIPT_ORIGIN, "https://cdn.callrail.com");
});

test("no broader permission is granted to reach those hosts", () => {
  const scriptSrc = directive(csp, "script-src");
  // A wildcard would admit every present and future CallRail subdomain.
  assert.equal(
    /\*/.test(scriptSrc),
    false,
    "no wildcard host in script-src",
  );
  assert.equal(scriptSrc.includes("*.callrail.com"), false);
  // strict-dynamic would let anything swap.js loads go on to load anything.
  assert.equal(scriptSrc.includes("strict-dynamic"), false);
  assert.equal(scriptSrc.includes("'self'"), false, "not even self");
  assert.equal(/\bhttp:/.test(scriptSrc), false, "https only");
  assert.equal(scriptSrc.includes("'unsafe-inline'"), false);
  assert.equal(scriptSrc.includes("'unsafe-eval'"), false);
  assert.equal(scriptSrc.includes("'unsafe-hashes'"), false);
  assert.equal(scriptSrc.includes("data:"), false);
  assert.equal(scriptSrc.includes("blob:"), false);
  // Nowhere else in the policy either.
  for (const keyword of [
    "unsafe-inline",
    "unsafe-eval",
    "unsafe-hashes",
    "strict-dynamic",
  ]) {
    assert.equal(csp.includes(keyword), false, `${keyword} must not appear`);
  }
});

test("connect-src stays wider than script-src, deliberately", () => {
  // CallRail may talk to its other hosts; none of them may execute.
  assert.match(directive(csp, "connect-src"), /https:\/\/\*\.callrail\.com/);
  assert.equal(directive(csp, "script-src").includes("*"), false);
});

test("the injected CallRail stylesheet stays blocked", () => {
  // swap.js calls injectCss() to add `.crjs .phoneswap { visibility: hidden }`.
  // This page has no such element, so the rule is cosmetic and the narrower
  // policy is worth more. style-src therefore carries a hash and no host.
  const styleSrc = directive(csp, "style-src");
  assert.deepEqual(hostsIn(styleSrc), [], "no host may serve style");
  assert.equal(styleSrc.includes("unsafe-inline"), false);
  assert.match(styleSrc, /'sha256-[A-Za-z0-9+/=]+'/);
});

test("the script tag still points at the CDN origin", () => {
  const tag = html.slice(html.indexOf(`id="${DNI_SCRIPT_ID}"`) - 220);
  assert.match(tag, /src="https:\/\/cdn\.callrail\.com\//);
});

test("nothing else is permitted at all", () => {
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test("a change to an inline block moves its hash with it", async () => {
  // The failure this guards is silent: a policy that lags the content does not
  // error, it blocks the script and the page quietly stops working.
  const other = await renderDniPage(SCRIPT_URL, "LB Marketing", [
    "fbclid",
    "gclid",
  ]);
  const mainA = inlineBody(html, '<script type="text/javascript">', "</script>");
  const mainB = inlineBody(
    other.html,
    '<script type="text/javascript">',
    "</script>",
  );
  assert.notEqual(mainA, mainB, "the allowlist changed the main script");
  assert.notEqual(
    directive(csp, "script-src"),
    directive(other.contentSecurityPolicy, "script-src"),
    "so script-src changed too",
  );
  assert.ok(
    directive(other.contentSecurityPolicy, "script-src").includes(
      `'${cspHashOf(mainB)}'`,
    ),
    "and the new policy matches the new bytes",
  );
});

test("the hash covers the bytes exactly, with no stray whitespace", () => {
  // A newline between the tag and its content is the classic way to serve a
  // policy that does not match. The emitter concatenates in one expression to
  // make that impossible; this proves it.
  const body = inlineBody(
    html,
    `<script type="text/javascript" id="${DNI_BOOTSTRAP_ID}">`,
    "</script>",
  );
  assert.equal(body, body.trim(), "no leading or trailing whitespace");
  assert.equal(body, buildDniBootstrapSource(), "served bytes are the built bytes");
});

// ------------------------------------------------------------ the swap rule

// The reported failure, exactly: the page announced a swap while the
// destination and the displayed number were both (254) 382-3256, and CallRail
// had not even finished loading.
const REGRESSION = "2543823256";

test("(254) 382-3256 against itself is not a swap", () => {
  const verdict = evaluateDniSwap({
    loaded: true,
    destination: REGRESSION,
    text: REGRESSION,
    href: REGRESSION,
  });
  assert.equal(verdict.swapped, false);
  assert.match(verdict.reason, /still the destination/);
});

test("(254) 382-3256 written any other way is still not a swap", () => {
  // Formatting alone must never qualify. Each of these is the same number.
  for (const written of [
    "(254) 382-3256",
    "254-382-3256",
    "254.382.3256",
    "+1 254 382 3256",
    "12543823256",
    " 2543823256 ",
  ]) {
    const normalized = normalizeDniDigits(written);
    assert.equal(normalized, REGRESSION, written);
    const verdict = evaluateDniSwap({
      loaded: true,
      destination: REGRESSION,
      text: normalized,
      href: normalized,
    });
    assert.equal(verdict.swapped, false, written);
  }
});

test("a swap is refused while CallRail has not loaded", () => {
  // The reported run sat at "checking..." and still claimed success.
  const verdict = evaluateDniSwap({
    loaded: false,
    destination: REGRESSION,
    text: "8005550111",
    href: "8005550111",
  });
  assert.equal(verdict.swapped, false);
  assert.match(verdict.reason, /has not loaded/);
});

test("both the visible text and the tel: link must carry a number", () => {
  for (const state of [
    { text: "", href: "8005550111" },
    { text: "8005550111", href: "" },
    { text: "", href: "" },
  ]) {
    const verdict = evaluateDniSwap({
      loaded: true,
      destination: REGRESSION,
      ...state,
    });
    assert.equal(verdict.swapped, false, JSON.stringify(state));
    assert.match(verdict.reason, /no usable number/);
  }
});

test("the visible text and the tel: link must agree", () => {
  // Half a rewrite is not a swap.
  const verdict = evaluateDniSwap({
    loaded: true,
    destination: REGRESSION,
    text: "8005550111",
    href: REGRESSION,
  });
  assert.equal(verdict.swapped, false);
  assert.match(verdict.reason, /disagree/);
});

test("with no destination there is nothing to compare against", () => {
  const verdict = evaluateDniSwap({
    loaded: true,
    destination: "",
    text: "8005550111",
    href: "8005550111",
  });
  assert.equal(verdict.swapped, false);
  assert.match(verdict.reason, /no destination/);
});

test("a genuine swap is reported, and only then", () => {
  const verdict = evaluateDniSwap({
    loaded: true,
    destination: REGRESSION,
    text: "8005550111",
    href: "8005550111",
  });
  assert.equal(verdict.swapped, true);
  assert.match(verdict.reason, /replaced/);
});

test("normalization collapses formatting and refuses non-numbers", () => {
  assert.equal(normalizeDniDigits("(254) 382-3256"), REGRESSION);
  assert.equal(normalizeDniDigits("+1 254 382 3256"), REGRESSION);
  assert.equal(normalizeDniDigits("12543823256"), REGRESSION);
  for (const bad of ["", "254382", "abc", null, undefined, 2543823256, "1234567890123"]) {
    assert.equal(normalizeDniDigits(bad), "", String(bad));
  }
});

test("the page's rule and the exported rule are the same rule", () => {
  // Two implementations of one decision, checked against each other across the
  // whole matrix rather than trusted to stay in step.
  const inline = new Function(
    `${buildDniSwapEvaluatorSource()} return evaluateSwap;`,
  )();
  const values = ["", REGRESSION, "8005550111"];
  for (const loaded of [true, false]) {
    for (const destination of values) {
      for (const text of values) {
        for (const href of values) {
          const state = { loaded, destination, text, href };
          assert.deepEqual(
            inline(state),
            evaluateDniSwap(state),
            JSON.stringify(state),
          );
        }
      }
    }
  }
});

test("the page decides loaded by looking for CallRail, not by a load event", () => {
  // swap.js is a classic script placed before this check, so its load event has
  // already fired by the time any listener could attach — which is why the
  // status previously never left "checking...".
  const main = buildDniMainSource(["fbclid"]);
  assert.deepEqual([...DNI_CALLRAIL_GLOBALS], ["CallTrk", "CallTrkSwap"]);
  assert.match(main, /function callrailLoaded\(\)/);
  assert.match(main, /typeof window\[GLOBALS\[i\]\]!=='undefined'/);
  assert.equal(
    /addEventListener\("load"/.test(main),
    false,
    "no reliance on a load event that has already fired",
  );
  // And the status is driven from that check on every tick.
  assert.match(main, /status\.textContent=loaded\?"loaded"/);
});

test("the page reports why, not just whether", () => {
  const main = buildDniMainSource(["fbclid"]);
  assert.match(main, /reason\.textContent=verdict\.reason/);
  // The normalized values it compared are shown, so a disputed verdict can be
  // checked by eye rather than argued about.
  for (const id of ["swap-destination", "swap-text-digits", "swap-href-digits"]) {
    assert.ok(html.includes(`id="${id}"`), `${id} is on the page`);
  }
});
