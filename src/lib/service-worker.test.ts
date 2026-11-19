import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The service worker (public/sw.js) is plain browser code that cannot be imported, so it is run here in a small pretend browser:
 * its event handlers are collected, and the cache and the network are replaced by simple stand-ins we control.
 */

const SOURCE = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://shop.example";

type Handler = (event: unknown) => void;

function makeWorld() {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>();
  const state = { online: true, status: 200, redirected: false, skipWaiting: false, offlinePageAvailable: true };
  const key = (r: string | { url: string }) => new URL(typeof r === "string" ? r : r.url, ORIGIN).pathname;
  const cacheApi = {
    async open(name: string) {
      const store = stores.get(name) ?? stores.set(name, new Map()).get(name)!;
      return {
        async match(r: string | { url: string }) {
          return store.get(key(r))?.clone();
        },
        async put(r: string | { url: string }, res: Response) {
          store.set(key(r), res);
        },
        async add(r: string) {
          if (!state.offlinePageAvailable) throw new Error("offline page missing");
          store.set(key(r), new Response("OFFLINE PAGE", { status: 200 }));
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  const sandbox = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
      skipWaiting: () => {
        state.skipWaiting = true;
      },
      clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
      registration: { showNotification: async () => {} },
    },
    caches: cacheApi,
    fetch: async () => {
      if (!state.online) throw new TypeError("Failed to fetch");
      const res = new Response("FROM NETWORK", { status: state.status });
      if (state.redirected) Object.defineProperty(res, "redirected", { value: true });
      return res;
    },
    Response,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    Error,
    TypeError,
  };
  vm.runInNewContext(SOURCE, sandbox);

  const waits: Promise<unknown>[] = [];
  const run = async (type: string, extra: Record<string, unknown> = {}) => {
    let answered: Promise<Response> | undefined;
    const event = {
      ...extra,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<Response>) => {
        answered = p;
      },
    };
    handlers.get(type)!(event);
    await Promise.all(waits.splice(0));
    return answered ? await answered : undefined;
  };
  const request = (path: string, init: { method?: string; mode?: string; origin?: string } = {}) => ({ method: init.method ?? "GET", mode: init.mode ?? "navigate", url: `${init.origin ?? ORIGIN}${path}` });
  return { handlers, stores, state, run, request };
}

let w: ReturnType<typeof makeWorld>;
beforeEach(async () => {
  w = makeWorld();
  await w.run("install");
});

describe("installing", () => {
  it("keeps the plain offline page and takes over at once", () => {
    expect(w.state.skipWaiting).toBe(true);
    expect([...w.stores.keys()]).toEqual(["ros-offline-v2"]);
    expect([...w.stores.get("ros-offline-v2")!.keys()]).toEqual(["/offline"]);
  });

  it("still installs if the offline page could not be fetched", async () => {
    const v = makeWorld();
    v.state.offlinePageAvailable = false;
    await v.run("install");
    expect(v.state.skipWaiting).toBe(true);
  });

  it("on activation removes the old versions of its own cache and nothing else", async () => {
    w.stores.set("ros-offline-v1", new Map());
    w.stores.set("somebody-elses-cache", new Map());
    await w.run("activate");
    expect([...w.stores.keys()].sort()).toEqual(["ros-offline-v2", "somebody-elses-cache"]);
  });
});

describe("a page that cannot be reached", () => {
  it("shows the friendly offline page instead of the browser's error", async () => {
    w.state.online = false;
    const res = await w.run("fetch", { request: w.request("/o/sometoken") });
    expect(await res!.text()).toBe("OFFLINE PAGE");
  });

  it("with no offline page saved, still answers with something readable", async () => {
    w.stores.get("ros-offline-v2")!.clear();
    w.state.online = false;
    const res = await w.run("fetch", { request: w.request("/dashboard") });
    expect(res!.status).toBe(503);
    expect(await res!.text()).toMatch(/offline/i);
  });

  it("never replaces what the server says: a working page, an error page and a redirect all pass through", async () => {
    expect(await (await w.run("fetch", { request: w.request("/orders") }))!.text()).toBe("FROM NETWORK");
    w.state.status = 500;
    const err = await w.run("fetch", { request: w.request("/orders") });
    expect(err!.status).toBe(500);
    expect(await err!.text()).toBe("FROM NETWORK");
  });

  it("keeps no page for later (only the offline page and the quick-order page are ever saved)", async () => {
    await w.run("fetch", { request: w.request("/bills") });
    await w.run("fetch", { request: w.request("/customers") });
    expect([...w.stores.get("ros-offline-v2")!.keys()]).toEqual(["/offline"]);
  });
});

describe("what it leaves alone", () => {
  it("does not touch changes (POST), other sites, or requests that are not page loads", async () => {
    expect(await w.run("fetch", { request: w.request("/orders", { method: "POST" }) })).toBeUndefined();
    expect(await w.run("fetch", { request: w.request("/x", { origin: "https://other.example" }) })).toBeUndefined();
    expect(await w.run("fetch", { request: w.request("/api/live", { mode: "cors" }) })).toBeUndefined();
    expect(await w.run("fetch", { request: w.request("/manifest.webmanifest", { mode: "cors" }) })).toBeUndefined();
  });
});

describe("quick order (works with no connection)", () => {
  it("saves a good copy while online and serves it when the connection is gone", async () => {
    await w.run("fetch", { request: w.request("/quick") });
    w.state.online = false;
    const res = await w.run("fetch", { request: w.request("/quick") });
    expect(await res!.text()).toBe("FROM NETWORK");
  });

  it("never saves a redirect (for example to the sign-in page)", async () => {
    w.state.redirected = true;
    await w.run("fetch", { request: w.request("/quick") });
    w.state.online = false;
    const res = await w.run("fetch", { request: w.request("/quick") });
    expect(res!.status).toBe(503);
    expect(await res!.text()).toMatch(/never opened online/);
  });

  it("says so plainly when it was never opened online on this phone", async () => {
    w.state.online = false;
    const res = await w.run("fetch", { request: w.request("/quick") });
    expect(res!.status).toBe(503);
  });
});

describe("the app's own scripts and styles", () => {
  it("are kept once and served from the phone afterwards", async () => {
    const first = await w.run("fetch", { request: w.request("/_next/static/chunks/a.js", { mode: "no-cors" }) });
    expect(await first!.text()).toBe("FROM NETWORK");
    w.state.online = false;
    const again = await w.run("fetch", { request: w.request("/_next/static/chunks/a.js", { mode: "no-cors" }) });
    expect(await again!.text()).toBe("FROM NETWORK"); // from the saved copy: the network is down
  });
});
