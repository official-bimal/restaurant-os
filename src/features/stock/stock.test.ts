import { describe, expect, it } from "vitest";
import { consumption, costOf, isUnit, margin, recipeCost, stockStatus, weightedAverageCost } from "./stock";

describe("costOf", () => {
  it("scales milli-paisa per unit to whole paisa", () => {
    expect(costOf(250, 80_000)).toBe(20_000); // 250 g at Rs 0.80/g = Rs 200
    expect(costOf(3, 500)).toBe(2); // 3 g of salt at 0.5 paisa/g = 1.5 paisa -> 2
    expect(costOf(-250, 80_000)).toBe(-20_000);
    expect(costOf(0, 80_000)).toBe(0);
  });
});

describe("weightedAverageCost", () => {
  it("blends the old stock and the new purchase", () => {
    // 1000 g at 0.80 paisa... use milli: 1000 units at 80_000 milli, buy 1000 more for Rs 1000 (100_000 paisa)
    expect(weightedAverageCost(1000, 80_000, 1000, 100_000)).toBe(90_000);
  });
  it("is just the purchase cost when nothing is on hand, or the book is negative", () => {
    expect(weightedAverageCost(0, 0, 500, 50_000)).toBe(100_000);
    expect(weightedAverageCost(-200, 99_999, 500, 50_000)).toBe(100_000);
  });
  it("keeps precision for very cheap items", () => {
    // 10 kg of salt (10,000 g) for Rs 200 (20,000 paisa) = 2 paisa/g = 2000 milli
    expect(weightedAverageCost(0, 0, 10_000, 20_000)).toBe(2_000);
    expect(weightedAverageCost(0, 0, 40_000, 20_000)).toBe(500); // 0.5 paisa/g
  });
  it("rejects bad input", () => {
    expect(() => weightedAverageCost(0, 0, 0, 100)).toThrow(RangeError);
    expect(() => weightedAverageCost(0, 0, 1.5, 100)).toThrow(RangeError);
    expect(() => weightedAverageCost(0, 0, 10, -1)).toThrow(RangeError);
    expect(() => weightedAverageCost(0, 0, 10, 1.5)).toThrow(RangeError);
  });
});

describe("recipeCost and margin", () => {
  it("adds up ingredient costs per portion", () => {
    // 120 g flour at 40 milli... 0.04 paisa? use 40_000 milli (40 paisa/g)? keep readable numbers:
    expect(recipeCost([{ quantity: 100, costMilli: 30_000 }, { quantity: 50, costMilli: 80_000 }])).toBe(7_000);
    expect(recipeCost([])).toBe(0);
  });
  it("computes the margin over price", () => {
    expect(margin(20_000, 7_000)).toEqual({ amount: 13_000, percent: 65 });
    expect(margin(0, 100)).toEqual({ amount: -100, percent: null });
    expect(margin(10_000, 12_000).amount).toBe(-2_000);
  });
});

describe("stockStatus", () => {
  it("flags negative, out, low and ok", () => {
    expect(stockStatus(-5, 100)).toBe("NEGATIVE");
    expect(stockStatus(0, 100)).toBe("OUT");
    expect(stockStatus(80, 100)).toBe("LOW");
    expect(stockStatus(100, 100)).toBe("LOW");
    expect(stockStatus(101, 100)).toBe("OK");
  });
  it("does not warn when no level is set", () => {
    expect(stockStatus(0, 0)).toBe("OK");
    expect(stockStatus(1, 0)).toBe("OK");
    expect(stockStatus(-1, 0)).toBe("NEGATIVE");
  });
});

describe("consumption", () => {
  const recipes = new Map([
    ["momo", [{ stockItemId: "flour", quantity: 30 }, { stockItemId: "chicken", quantity: 50 }]],
    ["burger", [{ stockItemId: "chicken", quantity: 120 }, { stockItemId: "bun", quantity: 1 }]],
  ]);
  it("multiplies recipe lines by portions and sums per stock item", () => {
    const used = consumption([{ menuItemId: "momo", quantity: 4 }, { menuItemId: "burger", quantity: 2 }, { menuItemId: "momo", quantity: 1 }], recipes);
    expect(Object.fromEntries(used)).toEqual({ flour: 150, chicken: 250 + 240, bun: 2 });
  });
  it("ignores dishes without a recipe", () => {
    expect(consumption([{ menuItemId: "tea", quantity: 9 }], recipes).size).toBe(0);
  });
});

describe("isUnit", () => {
  it("only allows the base units", () => {
    expect(["g", "ml", "piece"].every(isUnit)).toBe(true);
    expect(isUnit("kg")).toBe(false);
  });
});
