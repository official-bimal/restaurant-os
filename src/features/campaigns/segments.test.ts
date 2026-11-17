import { describe, expect, it } from "vitest";
import { firstName, renderTemplate, segmentOf, validateTemplate, VIP_SPEND } from "./segments";

const now = new Date("2026-11-16T10:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const c = (visitCount: number, daysAgo: number | null, totalSpend = 100_000) => ({
  visitCount,
  totalSpend,
  lastVisitAt: daysAgo === null ? null : ago(daysAgo),
});

describe("segmentOf", () => {
  it("puts each kind of customer in one segment", () => {
    expect(segmentOf(c(0, null, 0), now)).toBe("NO_VISIT");
    expect(segmentOf(c(1, 3), now)).toBe("NEW");
    expect(segmentOf(c(3, 10), now)).toBe("RETURNING");
    expect(segmentOf(c(8, 5), now)).toBe("REGULAR");
    expect(segmentOf(c(8, 5, VIP_SPEND), now)).toBe("VIP");
    expect(segmentOf(c(2, 45), now)).toBe("AT_RISK");
    expect(segmentOf(c(2, 120), now)).toBe("LOST");
  });

  it("lets lapsed guests outrank loyalty: a vanished VIP is at risk, not a VIP", () => {
    expect(segmentOf(c(20, 40, VIP_SPEND * 3), now)).toBe("AT_RISK");
    expect(segmentOf(c(20, 200, VIP_SPEND * 3), now)).toBe("LOST");
  });

  it("uses whole days and sharp boundaries", () => {
    expect(segmentOf(c(2, 30), now)).toBe("RETURNING"); // exactly 30 days: still fine
    expect(segmentOf(c(2, 31), now)).toBe("AT_RISK");
    expect(segmentOf(c(2, 90), now)).toBe("AT_RISK");
    expect(segmentOf(c(2, 91), now)).toBe("LOST");
    expect(segmentOf(c(4, 1), now)).toBe("RETURNING");
    expect(segmentOf(c(5, 1), now)).toBe("REGULAR");
  });

  it("treats a customer with visits but no date as having no visit", () => {
    expect(segmentOf({ visitCount: 3, totalSpend: 5, lastVisitAt: null }, now)).toBe("NO_VISIT");
  });
});

describe("validateTemplate", () => {
  it("accepts known placeholders and trims", () => {
    expect(validateTemplate("  Hi {name}, come back to {business} for {points} points within {days} days  ")).toMatch(/^Hi \{name\}/);
  });
  it("refuses empty, long, unknown or stray braces", () => {
    expect(() => validateTemplate("hi")).toThrow("at least a few words");
    expect(() => validateTemplate("x".repeat(321))).toThrow("under 320");
    expect(() => validateTemplate("Hi {nmae}, welcome")).toThrow("not a known placeholder");
    expect(() => validateTemplate("Hi {name, welcome back")).toThrow("stray");
    expect(() => validateTemplate("Hello } there friend")).toThrow("stray");
  });
});

describe("renderTemplate", () => {
  const v = { name: "Sita Rai", points: 50, days: 14, business: "Demo Cafe" };
  it("fills every placeholder, using first names only", () => {
    expect(renderTemplate("Hi {name}! {points} points at {business} in {days} days. {name}!", v)).toBe(
      "Hi Sita! 50 points at Demo Cafe in 14 days. Sita!",
    );
  });
  it("never writes 'null' for an unknown name", () => {
    expect(renderTemplate("Hi {name}", { ...v, name: null })).toBe("Hi there");
    expect(renderTemplate("Hi {name}", { ...v, name: "   " })).toBe("Hi there");
    expect(firstName("Ram")).toBe("Ram");
  });
  it("does not treat customer names as placeholders", () => {
    expect(renderTemplate("Hi {name}", { ...v, name: "{business} Ltd" })).toBe("Hi {business}");
  });
});
