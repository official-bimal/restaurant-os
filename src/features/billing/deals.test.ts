import { describe, expect, it } from "vitest";
import { bestDeal, combineDiscount, dealDiscount, isActiveAt, localDayMinute, type DealDef, type DealLine } from "./deals";

const line = (menuItemId: string, categoryId: string, unitPrice: number, quantity = 1, complimentary = false): DealLine => ({ menuItemId, categoryId, unitPrice, quantity, complimentary });
const happy: DealDef = { id: "h", name: "Happy hour", kind: "PERCENT_OFF", days: "", startMinute: 15 * 60, endMinute: 17 * 60, percentBps: 2_000, comboPrice: 0, items: [{ menuItemId: null, categoryId: "coffee", quantity: 1 }] };
const combo: DealDef = { id: "c", name: "Coffee and snack", kind: "COMBO", days: "", startMinute: null, endMinute: null, percentBps: 0, comboPrice: 30_000, items: [{ menuItemId: null, categoryId: "coffee", quantity: 1 }, { menuItemId: null, categoryId: "snack", quantity: 1 }] };

describe("when a deal is on", () => {
  it("follows the weekday and the time window, including one that runs past midnight", () => {
    expect(isActiveAt(happy, { day: 2, minute: 16 * 60 })).toBe(true);
    expect(isActiveAt(happy, { day: 2, minute: 17 * 60 })).toBe(false);
    expect(isActiveAt({ days: "0,6", startMinute: null, endMinute: null }, { day: 3, minute: 600 })).toBe(false);
    expect(isActiveAt({ days: "0,6", startMinute: null, endMinute: null }, { day: 6, minute: 600 })).toBe(true);
    const late = { days: "", startMinute: 22 * 60, endMinute: 2 * 60 };
    expect(isActiveAt(late, { day: 1, minute: 23 * 60 })).toBe(true);
    expect(isActiveAt(late, { day: 1, minute: 60 })).toBe(true);
    expect(isActiveAt(late, { day: 1, minute: 12 * 60 })).toBe(false);
  });
  it("reads the weekday and minute in the business's time zone", () => {
    // 2026-11-19 is a Thursday. 10:00 UTC is 15:45 in Kathmandu.
    expect(localDayMinute(new Date("2026-11-19T10:00:00Z"), "Asia/Kathmandu")).toEqual({ day: 4, minute: 15 * 60 + 45 });
    // 20:00 UTC is already Friday 01:45 in Kathmandu.
    expect(localDayMinute(new Date("2026-11-19T20:00:00Z"), "Asia/Kathmandu")).toEqual({ day: 5, minute: 105 });
  });
});

describe("happy hour", () => {
  it("takes the percentage off only the chosen category, and leaves free items alone", () => {
    const lines = [line("a", "coffee", 20_000, 2), line("b", "snack", 18_000), line("c", "coffee", 25_000, 1, true)];
    expect(dealDiscount(happy, lines)).toBe(8_000);
  });
  it("applies to everything when no dishes are chosen", () => {
    expect(dealDiscount({ ...happy, items: [] }, [line("a", "x", 10_000), line("b", "y", 10_000)])).toBe(4_000);
  });
});

describe("combos", () => {
  it("charges the set price for each whole bundle, using the cheapest matching dishes", () => {
    // coffee 20,000 + snack 18,000 = 38,000 for a bundle price of 30,000: saves 8,000.
    expect(dealDiscount(combo, [line("a", "coffee", 20_000), line("b", "snack", 18_000)])).toBe(8_000);
    // two coffees and one snack: one bundle only, with the cheaper coffee.
    expect(dealDiscount(combo, [line("a", "coffee", 20_000), line("a2", "coffee", 25_000), line("b", "snack", 18_000)])).toBe(8_000);
    // two of each: two bundles.
    expect(dealDiscount(combo, [line("a", "coffee", 20_000, 2), line("b", "snack", 18_000, 2)])).toBe(16_000);
  });
  it("gives nothing without a full bundle, or when the set price is not a saving", () => {
    expect(dealDiscount(combo, [line("a", "coffee", 20_000, 3)])).toBe(0);
    expect(dealDiscount({ ...combo, comboPrice: 50_000 }, [line("a", "coffee", 20_000), line("b", "snack", 18_000)])).toBe(0);
  });
  it("can require a certain number of one kind", () => {
    const two: DealDef = { ...combo, items: [{ menuItemId: null, categoryId: "coffee", quantity: 2 }], comboPrice: 35_000 };
    expect(dealDiscount(two, [line("a", "coffee", 20_000, 2)])).toBe(5_000);
    expect(dealDiscount(two, [line("a", "coffee", 20_000, 1)])).toBe(0);
  });
});

describe("choosing and combining", () => {
  const lines = [line("a", "coffee", 20_000), line("b", "snack", 18_000)];
  it("picks the deal that saves most, and none outside its hours", () => {
    const on = { day: 1, minute: 16 * 60 };
    expect(bestDeal([happy, combo], lines, on)?.deal.id).toBe("c"); // saves 8,000 against 4,000
    expect(bestDeal([happy], lines, { day: 1, minute: 9 * 60 })).toBeNull();
    expect(bestDeal([], lines, on)).toBeNull();
  });
  it("adds the person's own discount after the deal, never beyond the bill", () => {
    expect(combineDiscount({ kind: "none" }, 38_000, 8_000)).toEqual({ kind: "amount", amount: 8_000 });
    expect(combineDiscount({ kind: "percent", bps: 1_000 }, 38_000, 8_000)).toEqual({ kind: "amount", amount: 8_000 + 3_000 });
    expect(combineDiscount({ kind: "amount", amount: 99_999 }, 38_000, 8_000)).toEqual({ kind: "amount", amount: 38_000 });
  });
});
