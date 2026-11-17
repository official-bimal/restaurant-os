"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered page current. Signed-in pages listen to the live channel (/api/live): when the server says
 * something changed, the page re-fetches itself within a fraction of a second. While that channel is connected a slow
 * refresh (every 30 seconds) is kept only as a safety net; if the channel is down or unavailable, the page falls back to
 * refreshing every `everyMs`, exactly as before. Pages opened without a sign-in (the guest and tracking pages) pass
 * `live={false}` and just poll.
 */
export function AutoRefresh({ everyMs = 4000, live = true }: { everyMs?: number; live?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    let source: EventSource | null = null;
    let connected = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const startPolling = (ms: number) => {
      clearInterval(poll);
      poll = setInterval(refresh, ms);
    };

    startPolling(everyMs);
    if (live && typeof EventSource !== "undefined") {
      source = new EventSource("/api/live");
      source.addEventListener("hello", () => {
        connected = true;
        startPolling(Math.max(30_000, everyMs));
      });
      source.addEventListener("change", () => {
        clearTimeout(debounce);
        debounce = setTimeout(refresh, 250); // several changes at once make one refresh
      });
      source.onerror = () => {
        // The browser retries by itself; until it is back, poll at the normal pace.
        if (connected) {
          connected = false;
          startPolling(everyMs);
        }
      };
    }
    // Coming back to the tab (or the screen) catches up at once.
    document.addEventListener("visibilitychange", refresh);
    return () => {
      source?.close();
      clearInterval(poll);
      clearTimeout(debounce);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, everyMs, live]);
  return null;
}
