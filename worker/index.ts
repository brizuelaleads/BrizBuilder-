/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  describeSyncFailure,
  handleCallRailWebhook,
  reconcileCallRailIngestion,
} from "../lib/callrail-ingestion";
import { runNotificationSweeps } from "../lib/notification-sweeps";
import { syncMetaAdsInsights } from "../lib/meta-ads-sync";
import { advanceMetaAdsBackfills } from "../lib/meta-ads-backfill";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

function secureResponse(response: Response) {
  const secured = new Response(response.body, response);
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  secured.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  // Deliberately omits script-src/connect-src: the app relies on inline
  // hydration scripts and talks to Supabase and Stripe, so a tight policy
  // needs browser verification before being enforced. These directives are
  // the high-value, zero-breakage subset -- they stop clickjacking, base-tag
  // hijacking, plugin embedding, and form-based exfiltration. Routes that
  // set their own CSP (the AI consent screen) keep theirs.
  if (!secured.headers.has("Content-Security-Policy")) {
    secured.headers.set(
      "Content-Security-Policy",
      "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
    );
  }
  return secured;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/callrail/webhook/")) {
      return secureResponse(await handleCallRailWebhook(request, ctx));
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    return secureResponse(response);
  },

  async scheduled(
    _controller: ScheduledController,
    _env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      reconcileCallRailIngestion().catch((error) => {
        // Never hand a provider/database exception to the log sink: those can
        // contain request URLs, payload fragments, or customer data.
        console.error(
          "CallRail reconciliation failed.",
          describeSyncFailure(error),
        );
      }),
    );
    // Stale-lead and appointment reminders are found by scanning, not by an
    // event, so they ride the same tick. Kept as a separate waitUntil so
    // neither job can delay or fail the other.
    ctx.waitUntil(runNotificationSweeps());
    // Meta reports spend on its own schedule and offers no webhook, so the only
    // way to have it is to ask. Same tick, its own waitUntil: an ad platform
    // being slow or throttled must never hold up call ingestion.
    // Per-client failures are already caught, recorded against the connection,
    // and never rethrown, so anything arriving here is the enumerating query
    // itself. Logged without the exception: it can carry connection details.
    ctx.waitUntil(
      syncMetaAdsInsights().catch(() => {
        console.error("Meta Ads sync could not enumerate connected clients.");
      }),
    );
    // Historical backfills advance a few windows per tick. Separate from the
    // restatement sync above so a long backfill cannot delay recent numbers,
    // and it takes the same per-client claim so the two never call Meta for one
    // account at once.
    ctx.waitUntil(
      advanceMetaAdsBackfills().catch(() => {
        console.error("Meta Ads backfill could not enumerate open runs.");
      }),
    );
  },
};

export default worker;
