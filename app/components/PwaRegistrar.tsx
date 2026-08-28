"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the tenant app installable.
 *
 * Rendered inside the authenticated workspace only. Registering on the public
 * marketing pages would put a worker on the origin for visitors who will never
 * install anything, and it would have to be unregistered later to change that.
 */
export function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Dev servers hot-reload the worker into a confusing state, and the
    // install prompt needs HTTPS anyway.
    if (
      location.protocol !== "https:" &&
      location.hostname !== "localhost" &&
      location.hostname !== "127.0.0.1"
    )
      return;

    let cancelled = false;
    const register = () => {
      if (cancelled) return;
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
        // A failed registration costs the install prompt, not the app.
        console.warn("Service worker registration failed.", error);
      });
    };

    // Registering after load keeps the worker off the critical path for the
    // first paint of the dashboard.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
