import { describe, expect, it } from "vitest";
import { splitEvenly } from "./split";

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe("splitEvenly", () => {
  it("splits whole-rupee totals in whole rupees, extra rupees to the first people", () => {
    expect(splitEvenly(118_100, 3)).toEqual([39_400, 39_400, 39_300]); // Rs 1181 -> 394, 394, 393
    expect(splitEvenly(100_000, 4)).toEqual([25_000, 25_000, 25_000, 25_000]);
  });

  it("falls back to paisa when the total is not a whole rupee", () => {
    const parts = splitEvenly(10_001, 2);
    expect(parts).toEqual([5_001, 5_000]);
    expect(sum(parts)).toBe(10_001);
  });

  it("always adds up exactly and never differs by more than one unit", () => {
    for (const total of [0, 1, 99, 100, 12_345, 118_100, 9_999_900]) {
      for (const n of [1, 2, 3, 7, 50]) {
        const parts = splitEvenly(total, n);
        expect(parts).toHaveLength(n);
        expect(sum(parts)).toBe(total);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(total % 100 === 0 ? 100 : 1);
      }
    }
  });

  it("rejects bad input", () => {
    expect(() => splitEvenly(100, 0)).toThrow(RangeError);
    expect(() => splitEvenly(100, 51)).toThrow(RangeError);
    expect(() => splitEvenly(100, 2.5)).toThrow(RangeError);
    expect(() => splitEvenly(-1, 2)).toThrow(RangeError);
    expect(() => splitEvenly(10.5, 2)).toThrow(RangeError);
  });
});
