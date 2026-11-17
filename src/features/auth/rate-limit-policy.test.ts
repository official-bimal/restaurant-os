import { describe, expect, it } from "vitest";
import { formatWait, retryAfterSeconds } from "./rate-limit-policy";
import { clientIpFromHeaders } from "@/server/client-ip";

const rule = { max: 5, windowMs: 15 * 60_000 };
const now = 1_000_000_000;
const ago = (s: number) => now - s * 1000;

describe("retryAfterSeconds", () => {
  it("allows when under the limit", () => {
    expect(retryAfterSeconds([], rule, now)).toBe(0);
    expect(retryAfterSeconds([ago(10), ago(20), ago(30), ago(40)], rule, now)).toBe(0);
  });

  it("blocks at the limit until the oldest attempt ages out", () => {
    const attempts = [ago(600), ago(500), ago(400), ago(300), ago(200)]; // 5 in window
    // oldest is 600s old; window is 900s, so free again in 300s
    expect(retryAfterSeconds(attempts, rule, now)).toBe(300);
  });

  it("waits for enough attempts to expire when well over the limit", () => {
    // 7 attempts: must drop to 4, so the 3rd-oldest has to expire
    const attempts = [ago(800), ago(700), ago(600), ago(500), ago(400), ago(300), ago(200)];
    expect(retryAfterSeconds(attempts, rule, now)).toBe(300); // the 600s-old one: 900-600
  });

  it("ignores attempts outside the window", () => {
    const attempts = [ago(1000), ago(2000), ago(3000), ago(4000), ago(5000), ago(10)];
    expect(retryAfterSeconds(attempts, rule, now)).toBe(0);
  });

  it("is order independent and never returns less than one second when blocked", () => {
    const a = [ago(1), ago(2), ago(3), ago(4), ago(899)];
    expect(retryAfterSeconds(a, rule, now)).toBe(1);
    expect(retryAfterSeconds([...a].reverse(), rule, now)).toBe(1);
  });
});

describe("formatWait", () => {
  it("rounds up to whole minutes", () => {
    expect(formatWait(1)).toBe("a minute");
    expect(formatWait(60)).toBe("a minute");
    expect(formatWait(61)).toBe("2 minutes");
    expect(formatWait(900)).toBe("15 minutes");
  });
});

describe("clientIpFromHeaders", () => {
  const h = (v?: string) => ({ get: (n: string) => (n.toLowerCase() === "x-forwarded-for" ? (v ?? null) : null) });

  it("ignores the header unless proxies are trusted", () => {
    expect(clientIpFromHeaders(h("203.0.113.5"), 0)).toBeNull();
  });

  it("counts from the end, so a spoofed first entry is ignored", () => {
    expect(clientIpFromHeaders(h("1.2.3.4, 203.0.113.5"), 1)).toBe("203.0.113.5");
    expect(clientIpFromHeaders(h("9.9.9.9, 203.0.113.5, 10.0.0.1"), 2)).toBe("203.0.113.5");
  });

  it("returns null for missing, short or invalid values", () => {
    expect(clientIpFromHeaders(h(undefined), 1)).toBeNull();
    expect(clientIpFromHeaders(h("203.0.113.5"), 2)).toBeNull();
    expect(clientIpFromHeaders(h("not-an-ip"), 1)).toBeNull();
    expect(clientIpFromHeaders(h("2001:db8::1"), 1)).toBe("2001:db8::1");
  });
});
