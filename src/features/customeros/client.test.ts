import { beforeAll, describe, expect, it } from "vitest";
import { seal, unseal } from "@/lib/secretbox";
import { cleanBaseUrl, cosLookup, cosPing, cosRecordPurchase, type FetchLike } from "./client";

beforeAll(() => {
  process.env.SESSION_SECRET ??= "x".repeat(40);
});

const target = { baseUrl: "https://c.example.com", key: "cos_live_secret" };
const reply = (status: number, body: unknown): FetchLike => async () => new Response(JSON.stringify(body), { status });

describe("cleanBaseUrl", () => {
  it("keeps scheme, host, port and path prefix, and drops the trailing slash", () => {
    expect(cleanBaseUrl(" https://c.example.com/ ")).toBe("https://c.example.com");
    expect(cleanBaseUrl("http://localhost:3100")).toBe("http://localhost:3100");
    expect(cleanBaseUrl("https://c.example.com/os/")).toBe("https://c.example.com/os");
  });
  it("refuses other schemes, credentials, queries, fragments and nonsense", () => {
    for (const bad of ["ftp://c.example.com", "javascript:alert(1)", "https://u:p@c.example.com", "https://c.example.com?x=1", "https://c.example.com#a", "c.example.com", ""]) {
      expect(cleanBaseUrl(bad)).toBeNull();
    }
  });
});

describe("secretbox", () => {
  it("round-trips, never repeats, and refuses damage", () => {
    const a = seal("cos_live_abc");
    expect(a).not.toContain("cos_live_abc");
    expect(seal("cos_live_abc")).not.toBe(a);
    expect(unseal(a)).toBe("cos_live_abc");
    expect(unseal(a.slice(0, -2) + "AA")).toBeNull();
    expect(unseal("garbage")).toBeNull();
  });
  it("cannot be read after SESSION_SECRET changes", () => {
    const before = process.env.SESSION_SECRET;
    const a = seal("k");
    process.env.SESSION_SECRET = "y".repeat(40);
    expect(unseal(a)).toBeNull();
    process.env.SESSION_SECRET = before;
  });
});

describe("the Customer OS client", () => {
  it("sends the key as a bearer token and returns the data", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const f: FetchLike = async (url, init) => {
      seen = { url, auth: new Headers(init.headers as HeadersInit).get("authorization") };
      return new Response(JSON.stringify({ ok: true, data: { business: "X" } }), { status: 200 });
    };
    const r = await cosPing(target, { fetchImpl: f });
    expect(r).toEqual({ ok: true, data: { business: "X" } });
    expect(seen).toEqual({ url: "https://c.example.com/api/integrations/v1/ping", auth: "Bearer cos_live_secret" });
  });

  it("marks outages, rate limits and a bad key as worth retrying, and bad requests as not", async () => {
    for (const status of [401, 429, 500, 503]) {
      expect(await cosLookup(target, "98", { fetchImpl: reply(status, { ok: false, error: { message: "m" } }) })).toMatchObject({ ok: false, retry: true, status });
    }
    for (const status of [400, 402, 404, 409, 422]) {
      expect(await cosRecordPurchase(target, { externalId: "i", phone: "p", amountMinor: 1, occurredAt: "t" }, { fetchImpl: reply(status, { ok: false, error: { message: "m" } }) })).toMatchObject({ ok: false, retry: false, status });
    }
  });

  it("treats a network failure, a timeout and a non-JSON answer as retryable without throwing", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const slow: FetchLike = async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    };
    expect(await cosPing(target, { fetchImpl: down })).toMatchObject({ ok: false, retry: true, status: 0, message: "Could not reach Customer OS." });
    expect(await cosPing(target, { fetchImpl: slow })).toMatchObject({ ok: false, retry: true, message: "Customer OS did not answer in time." });
    const html: FetchLike = async () => new Response("<html>bad gateway</html>", { status: 502 });
    expect(await cosPing(target, { fetchImpl: html })).toMatchObject({ ok: false, retry: true, status: 502 });
    const weird: FetchLike = async () => new Response("<html>ok</html>", { status: 200 });
    expect(await cosPing(target, { fetchImpl: weird })).toMatchObject({ ok: false });
  });
});
