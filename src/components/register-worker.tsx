"use client";

import { useEffect } from "react";

/**
 * Registers the app's service worker on pages that are not signed in (the customer ordering page). The worker shows a friendly
 * "you are offline" page instead of the browser's error, and lets the phone treat the page as an installable app. It keeps no
 * customer data. A phone without a secure address (plain http) or without service worker support simply skips it.
 */
export function RegisterWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* not available here (for example plain http): the page works exactly as before */
    });
  }, []);
  return null;
}
