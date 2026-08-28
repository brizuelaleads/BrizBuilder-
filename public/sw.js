/*
 * BrizBuilder white-label service worker.
 *
 * Deliberately brand-agnostic. Tenant subdomains are separate origins and so
 * get their own registration, while the shared app host serves every tenant
 * from one worker -- caching anything branded here would leak one client's
 * logo or colours into another client's shell.
 *
 * Scope is the origin root because the file is served from /sw.js.
 */

const VERSION = "brizbuilder-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const OFFLINE_URL = "/offline.html";

// Only genuinely static, brand-neutral assets are precached.
const PRECACHE = [OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      // A precache miss must never block activation, or a single 404 leaves
      // the app permanently without a worker.
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("brizbuilder-") && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/*
 * Network-first for navigations, with an offline page as the only fallback.
 * CRM data is tenant-scoped and permission-checked on the server, so none of
 * it is cached here: a stale or cross-tenant read would be worse than an
 * offline message.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The manifest is per-tenant and per-user; always go to the network.
  if (url.pathname === "/manifest.webmanifest") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(OFFLINE_URL)
          .then(
            (cached) =>
              cached ??
              new Response("You are offline.", {
                status: 503,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              }),
          ),
      ),
    );
    return;
  }

  // Static build output is content-hashed, so cache-first is safe there only.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

/*
 * Push delivery. The payload carries its own branding because a single worker
 * on the shared host serves every tenant -- the sender decides whose logo and
 * title appear, not this file.
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  const title = payload.title || "New activity";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: payload.icon || "/brand/brizbuilder-icon.png",
      badge: payload.badge || "/brand/brizbuilder-icon.png",
      tag: payload.tag,
      data: { url: payload.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(target) && "focus" in client)
            return client.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
