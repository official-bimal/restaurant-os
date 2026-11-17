import { describe, expect, it } from "vitest";
import { maxRedeemBlocks, pointsEarned, redemptionDiscount, RedemptionError, validateSettings } from "./points";

const on = { enabled: true, pointsPer100: 10 };

describe("pointsEarned", () => {
  it("floors on the final bill", () => {
    expect(pointsEarned(47_000, on)).toBe(47); // Rs 470 -> 47
    expect(pointsEarned(49_999, on)).toBe(49); // Rs 499.99 never rounds up
    expect(pointsEarned(9_999, on)).toBe(9);
  });
  it("is zero when disabled, free, or set to zero", () => {
    expect(pointsEarned(47_000, { ...on, enabled: false })).toBe(0);
    expect(pointsEarned(0, on)).toBe(0);
    expect(pointsEarned(47_000, { enabled: true, pointsPer100: 0 })).toBe(0);
  });
});

describe("redemptionDiscount", () => {
  const s = { redeemPoints: 100, redeemValue: 5_000 };
  it("pays out in whole blocks", () => {
    expect(redemptionDiscount(0, s)).toBe(0);
    expect(redemptionDiscount(100, s)).toBe(5_000);
    expect(redemptionDiscount(300, s)).toBe(15_000);
  });
  it("rejects partial blocks, negatives and fractions", () => {
    expect(() => redemptionDiscount(150, s)).toThrow(RedemptionError);
    expect(() => redemptionDiscount(-100, s)).toThrow(RedemptionError);
    expect(() => redemptionDiscount(100.5, s)).toThrow(RedemptionError);
    expect(() => redemptionDiscount(100, { redeemPoints: 0, redeemValue: 0 })).toThrow("not set up");
  });
});

describe("maxRedeemBlocks", () => {
  const s = { redeemPoints: 100, redeemValue: 5_000 };
  it("is limited by balance and by the bill", () => {
    expect(maxRedeemBlocks(450, 100_000, s)).toBe(4); // balance bound
    expect(maxRedeemBlocks(10_000, 12_000, s)).toBe(2); // bill bound (Rs 120 -> two Rs 50 blocks)
    expect(maxRedeemBlocks(50, 100_000, s)).toBe(0);
    expect(maxRedeemBlocks(500, 0, s)).toBe(0);
  });
});

describe("validateSettings", () => {
  const ok = { enabled: true, pointsPer100: 10, redeemPoints: 100, redeemValue: 5_000 };
  it("accepts sensible settings", () => expect(validateSettings(ok)).toBeNull());
  it("rejects nonsense and programs that give back more than the bill", () => {
    expect(validateSettings({ ...ok, pointsPer100: -1 })).toMatch(/Points per/);
    expect(validateSettings({ ...ok, redeemPoints: 0 })).toMatch(/block/);
    expect(validateSettings({ ...ok, redeemValue: 50 })).toMatch(/Rs 1/);
    expect(validateSettings({ ...ok, pointsPer100: 100, redeemPoints: 10, redeemValue: 50_000 })).toMatch(/more than the bill/);
  });
});
