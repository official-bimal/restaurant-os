import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, evaluateRules, type DayFacts } from "./rules";

const empty: DayFacts = { date: "2026-11-24", voids: { count: 0, amount: 0 }, invoices: [], refunds: [], cashDiffs: [] };
const T = DEFAULT_THRESHOLDS;
const kinds = (f: DayFacts, t = T) => evaluateRules(f, t).map((c) => c.kind);

describe("evaluateRules", () => {
  it("says nothing about a quiet, clean day", () => {
    expect(evaluateRules(empty, T)).toEqual([]);
    const normal: DayFacts = { ...empty, voids: { count: 1, amount: 20_000 }, invoices: [{ id: "a", number: 1, subtotal: 100_000, discount: 5_000 }], refunds: [{ id: "r", number: 1, invoiceNumber: 1, amount: 10_000, partial: true }], cashDiffs: [{ branch: "Main", difference: -2_000 }] };
    expect(evaluateRules(normal, T)).toEqual([]);
  });

  it("flags many cancelled bills, and a large value cancelled", () => {
    expect(kinds({ ...empty, voids: { count: 3, amount: 1_000 } })).toEqual(["VOIDS"]);
    expect(kinds({ ...empty, voids: { count: 1, amount: 500_000 } })).toEqual(["VOID_AMOUNT"]);
    expect(kinds({ ...empty, voids: { count: 5, amount: 900_000 } })).toEqual(["VOIDS", "VOID_AMOUNT"]);
    expect(kinds({ ...empty, voids: { count: 2, amount: 499_999 } })).toEqual([]);
  });

  it("flags each bill whose discount reaches the percent, with its own key, and ignores no-discount bills", () => {
    const f: DayFacts = { ...empty, invoices: [{ id: "a", number: 7, subtotal: 100_000, discount: 20_000 }, { id: "b", number: 8, subtotal: 100_000, discount: 19_999 }, { id: "c", number: 9, subtotal: 0, discount: 0 }] };
    const r = evaluateRules(f, T).filter((c) => c.kind === "DISCOUNT_BILL");
    expect(r.map((c) => c.key)).toEqual(["a"]);
    expect(r[0]!.title).toBe("20% discount on invoice #7");
  });

  it("flags discounts that are a big share of the day's sales", () => {
    const f: DayFacts = { ...empty, invoices: [{ id: "a", number: 1, subtotal: 100_000, discount: 8_000 }, { id: "b", number: 2, subtotal: 100_000, discount: 12_000 }] };
    expect(kinds(f)).toEqual(["DISCOUNT_SHARE"]); // 20,000 of 200,000 = 10%, no single bill reaches 20%
    expect(evaluateRules(f, T)[0]!.title).toBe("Discounts were 10% of sales");
    expect(kinds({ ...f, invoices: [{ id: "a", number: 1, subtotal: 100_000, discount: 9_000 }] }, T)).toEqual([]);
  });

  it("flags each large refund by its credit note, and cash that is short or over", () => {
    const f: DayFacts = { ...empty, refunds: [{ id: "r1", number: 4, invoiceNumber: 30, amount: 600_000, partial: false }, { id: "r2", number: 5, invoiceNumber: 31, amount: 100_000, partial: true }], cashDiffs: [{ branch: "Main", difference: -15_000 }, { branch: "Lakeside", difference: 20_000 }, { branch: "Third", difference: 5_000 }] };
    const r = evaluateRules(f, T);
    expect(r.filter((c) => c.kind === "REFUND").map((c) => c.key)).toEqual(["r1"]);
    expect(r.filter((c) => c.kind === "CASH_DIFFERENCE").map((c) => [c.key, c.title])).toEqual([["Main", "Main: cash short by Rs 150"], ["Lakeside", "Lakeside: cash over by Rs 200"]]);
  });

  it("treats a threshold of 0 as switched off", () => {
    const off = { alertVoidCount: 0, alertVoidAmount: 0, alertDiscountPct: 0, alertDiscountShareBps: 0, alertRefundAmount: 0, alertCashDiff: 0 };
    const busy: DayFacts = { ...empty, voids: { count: 50, amount: 9_000_000 }, invoices: [{ id: "a", number: 1, subtotal: 100, discount: 100 }], refunds: [{ id: "r", number: 1, invoiceNumber: 1, amount: 9_000_000, partial: false }], cashDiffs: [{ branch: "Main", difference: -9_000_000 }] };
    expect(evaluateRules(busy, off)).toEqual([]);
  });

  it("describes what was counted and the limit, never who did it", () => {
    for (const c of evaluateRules({ ...empty, voids: { count: 4, amount: 600_000 } }, T)) {
      expect(c.detail).toMatch(/your limit is/);
      expect(c.detail).not.toMatch(/steal|fraud|cheat|theft/i);
    }
  });
});
