import { describe, expect, it } from "vitest";
import {
  summarizeDishRatings,
  publicDishRating,
  cleanComment,
  cleanReviewUrl,
  FEEDBACK_WINDOW_MS,
  isValidRating,
  needsAttention,
  summarizeRatings,
  withinWindow,
} from "./rating";

describe("ratings", () => {
  it("accepts only whole numbers from 1 to 5", () => {
    for (const ok of [1, 2, 3, 4, 5]) expect(isValidRating(ok)).toBe(true);
    for (const bad of [0, 6, -1, 2.5, NaN, "5", null, undefined]) expect(isValidRating(bad)).toBe(false);
  });

  it("flags 3 stars and below for attention", () => {
    expect([1, 2, 3].every(needsAttention)).toBe(true);
    expect([4, 5].some(needsAttention)).toBe(false);
  });
});

describe("summarizeRatings", () => {
  it("counts, averages to one decimal, and builds the distribution", () => {
    const s = summarizeRatings([5, 5, 4, 1, 3]);
    expect(s).toEqual({ count: 5, average: 3.6, distribution: [1, 0, 1, 1, 2] });
  });
  it("handles no ratings and ignores invalid values", () => {
    expect(summarizeRatings([])).toEqual({ count: 0, average: null, distribution: [0, 0, 0, 0, 0] });
    expect(summarizeRatings([9, 0, 4]).count).toBe(1);
  });
});

describe("withinWindow", () => {
  const closed = new Date("2026-11-16T10:00:00Z");
  it("allows the first 24 hours only", () => {
    expect(withinWindow(closed, new Date(closed.getTime() + 1000))).toBe(true);
    expect(withinWindow(closed, new Date(closed.getTime() + FEEDBACK_WINDOW_MS))).toBe(true);
    expect(withinWindow(closed, new Date(closed.getTime() + FEEDBACK_WINDOW_MS + 1))).toBe(false);
    expect(withinWindow(closed, new Date(closed.getTime() - 1000))).toBe(false);
  });
});

describe("cleanReviewUrl", () => {
  it("accepts https links, treats blank as none", () => {
    expect(cleanReviewUrl("https://g.page/r/abc/review")).toBe("https://g.page/r/abc/review");
    expect(cleanReviewUrl("  ")).toBeNull();
    expect(cleanReviewUrl(null)).toBeNull();
  });
  it("refuses anything that is not a plain https address", () => {
    for (const bad of ["javascript:alert(1)", "http://example.com", "data:text/html,hi", "example.com", "https://user:pw@example.com", "ftp://x.y"]) {
      expect(() => cleanReviewUrl(bad), bad).toThrow();
    }
    expect(() => cleanReviewUrl("https://example.com/" + "a".repeat(500))).toThrow("too long");
  });
});

describe("cleanComment", () => {
  it("trims, collapses whitespace and treats blank as none", () => {
    expect(cleanComment("  Slow   service \n today ")).toBe("Slow service today");
    expect(cleanComment("   ")).toBeNull();
    expect(cleanComment(undefined)).toBeNull();
  });
  it("rejects very long comments", () => {
    expect(() => cleanComment("x".repeat(501))).toThrow("under 500");
    expect(cleanComment("x".repeat(500))).toHaveLength(500);
  });
});

describe("publicDishRating", () => {
  it("hides a dish's stars until enough guests have rated it", () => {
    expect(publicDishRating(5, 1)).toBeNull();
    expect(publicDishRating(10, 2)).toBeNull();
    expect(publicDishRating(0, 0)).toBeNull();
  });
  it("shows the average to one decimal once it has enough ratings", () => {
    expect(publicDishRating(14, 3)).toEqual({ average: 4.7, count: 3 });
    expect(publicDishRating(20, 4)).toEqual({ average: 5, count: 4 });
  });
  it("refuses nonsense", () => {
    expect(publicDishRating(Number.NaN, 5)).toBeNull();
    expect(publicDishRating(10, 3.5)).toBeNull();
  });
});

describe("summarizeDishRatings", () => {
  const row = (name: string, d: [number, number, number, number, number]) => ({ menuItemId: name, name, distribution: d });
  it("lists the lowest-rated dishes first and flags weak ones and ones with few ratings", () => {
    const lines = summarizeDishRatings([
      row("Great", [0, 0, 0, 2, 8]),
      row("Weak", [3, 2, 3, 0, 0]),
      row("New", [0, 0, 0, 0, 1]),
      row("Unrated", [0, 0, 0, 0, 0]),
    ]);
    expect(lines.map((l) => [l.name, l.average, l.count])).toEqual([["Weak", 2, 8], ["Great", 4.8, 10], ["New", 5, 1]]);
    expect(lines.find((l) => l.name === "Weak")).toMatchObject({ weak: true, few: false });
    expect(lines.find((l) => l.name === "New")).toMatchObject({ weak: false, few: true });
    expect(lines.find((l) => l.name === "Great")).toMatchObject({ weak: false, few: false });
  });
  it("does not call a dish weak on too few ratings, even if they are low", () => {
    const [l] = summarizeDishRatings([row("Two", [2, 0, 0, 0, 0])]);
    expect(l).toMatchObject({ average: 1, few: true, weak: false });
  });
  it("breaks ties by number of ratings, then name", () => {
    const lines = summarizeDishRatings([row("B", [0, 0, 3, 0, 0]), row("A", [0, 0, 3, 0, 0]), row("C", [0, 0, 5, 0, 0])]);
    expect(lines.map((l) => l.name)).toEqual(["C", "A", "B"]);
  });
});
