import { beforeEach, describe, expect, it } from "vitest";
import { allow, resetLimits } from "@/server/rate-limit";
import { LIMITS, cleanText, isOnlineType, isStale, isToken, prepMessage, statusText } from "./rules";

describe("cleanText", () => {
  it("trims, collapses blanks, drops control characters and cuts to length", () => {
    expect(cleanText("  Sita \n  Rai\t ", 60)).toBe("Sita Rai");
    expect(cleanText("a\u0000b\u0007c", 10)).toBe("a b c");
    expect(cleanText("x".repeat(500), 20)).toHaveLength(20);
    expect(cleanText(null, 10)).toBe("");
    expect(cleanText(undefined, 10)).toBe("");
  });
});

describe("tokens and types", () => {
  it("accepts a long random token and nothing else", () => {
    expect(isToken("wRkuemlDgiqdJfkpPDCExKBG")).toBe(true);
    expect(isToken("short")).toBe(false);
    expect(isToken("has spaces in it but long enough")).toBe(false);
    expect(isToken("../../etc/passwd/../../")).toBe(false);
    expect(isToken(undefined)).toBe(false);
    expect(isToken("x".repeat(65))).toBe(false);
  });
  it("knows the two online order types", () => {
    expect(isOnlineType("TAKEAWAY")).toBe(true);
    expect(isOnlineType("DELIVERY")).toBe(true);
    expect(isOnlineType("DINE_IN")).toBe(false);
    expect(isOnlineType("QUICK_BILL")).toBe(false);
  });
});

describe("what customers are told", () => {
  it("rounds the wait to five minutes and never says less than five", () => {
    expect(prepMessage(20, "TAKEAWAY")).toBe("Ready for pickup in about 20 minutes.");
    expect(prepMessage(22, "TAKEAWAY")).toBe("Ready for pickup in about 20 minutes.");
    expect(prepMessage(1, "TAKEAWAY")).toBe("Ready for pickup in about 5 minutes.");
    expect(prepMessage(30, "DELIVERY")).toBe("About 30 minutes to prepare, plus the ride to you.");
  });
  it("has words for every state", () => {
    for (const s of ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"] as const) expect(statusText(s).title.length).toBeGreaterThan(3);
  });
});

describe("stale requests", () => {
  it("are those older than the limit", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    expect(isStale(new Date(now.getTime() - 59 * 60_000), now)).toBe(false);
    expect(isStale(new Date(now.getTime() - 61 * 60_000), now)).toBe(true);
    expect(isStale(new Date(now.getTime() - 20 * 60_000), now, 10)).toBe(true);
    expect(LIMITS.staleMinutes).toBe(60);
  });
});

describe("the rate limiter", () => {
  beforeEach(resetLimits);
  it("allows up to the limit in a window, then refuses, then allows again after the window", () => {
    const t0 = 1_000_000;
    expect([1, 2, 3].map((i) => allow("k", 3, 60_000, t0 + i))).toEqual([true, true, true]);
    expect(allow("k", 3, 60_000, t0 + 10)).toBe(false);
    expect(allow("k", 3, 60_000, t0 + 61_000)).toBe(true);
  });
  it("counts each key on its own", () => {
    expect(allow("a", 1, 1000, 0)).toBe(true);
    expect(allow("a", 1, 1000, 1)).toBe(false);
    expect(allow("b", 1, 1000, 1)).toBe(true);
  });
});
