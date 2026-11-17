/* Service worker for background alerts (Web Push) and offline order taking.
 *
 * Alerts: it only shows a short notification and opens the app when it is tapped.
 *
 * Offline: it keeps exactly two things so the Quick order page (/quick) can open with no connection:
 *   - the page itself, network first (a fresh copy whenever the network answers within 4 seconds, the saved copy otherwise);
 *     a redirect (for example to the sign-in page) is never saved, and
 *   - the app's own fixed script and style files (/_next/static/..., named by content, so they never go stale).
 * Every other request goes straight to the network untouched, so no other page, bill or customer data is kept here. */

const CACHE = "ros-offline-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith("ros-offline-")).map((k) => caches.delete(k)))),
      self.clients.claim(),
    ]),
  ),
);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate" && url.pathname === "/quick") {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const res = await Promise.race([
            fetch(req),
            new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 4000)),
          ]);
          if (res.ok && !res.redirected) cache.put("/quick", res.clone());
          return res;
        } catch {
          const saved = await cache.match("/quick");
          return saved || new Response("You are offline and this page was never opened online on this phone.", { status: 503 });
        }
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Restaurant OS", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Restaurant OS";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || "ros-alert",
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/notifications" },
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
