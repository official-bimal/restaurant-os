import { describe, expect, it } from "vitest";
import { billTimeProblem, checkDiscount, checkPayments, nextInvoiceNumber, numbersLeft, OfflineBillError, priceOfflineBill, type OfflineSnapshot } from "./billing";

const snap: OfflineSnapshot = {
  v: 1,
  issuedAt: "2026-11-20T06:00:00.000Z",
  businessId: "biz",
  branchId: "br",
  userId: "u",
  business: { name: "Cafe", pan: "1", timezone: "Asia/Kathmandu", serviceChargeBps: 1000, vatMode: "EXCLUSIVE", vatBps: 1300, vatAppliesToServiceCharge: true, roundToRupee: true },
  branch: { name: "Main", address: null },
  items: [
    { id: "momo", name: "Buff Momo", price: 25_000, category: "Food" },
    { id: "tea", name: "Tea", price: 8_000, category: "Drinks" },
  ],
  tables: [{ id: "t1", label: "T1" }],
};

describe("priceOfflineBill", () => {
  it("works the bill out from the snapshot's prices and settings", () => {
    const { lines, totals } = priceOfflineBill(snap, [{ menuItemId: "momo", quantity: 2 }, { menuItemId: "tea", quantity: 1, note: " no sugar " }], { kind: "none" });
    expect(lines.map((l) => [l.name, l.quantity, l.unitPrice, l.note])).toEqual([["Buff Momo", 2, 25_000, null], ["Tea", 1, 8_000, "no sugar"]]);
    expect(totals.subtotal).toBe(58_000);
    expect(totals.serviceCharge).toBe(5_800);
    expect(totals.vat).toBe(Math.round((58_000 + 5_800) * 0.13));
    expect(totals.grandTotal).toBe(totals.subtotal + totals.serviceCharge + totals.vat + totals.roundOff);
  });
  it("gives the same answer every time (the phone and the server must agree)", () => {
    const a = priceOfflineBill(snap, [{ menuItemId: "momo", quantity: 3 }], { kind: "percent", bps: 1500 });
    const b = priceOfflineBill(JSON.parse(JSON.stringify(snap)), [{ menuItemId: "momo", quantity: 3 }], { kind: "percent", bps: 1500 });
    expect(a).toEqual(b);
    expect(a.totals.discount).toBe(Math.round(75_000 * 0.15));
  });
  it("refuses unknown dishes, bad quantities and empty or oversize bills", () => {
    expect(() => priceOfflineBill(snap, [{ menuItemId: "ghost", quantity: 1 }], { kind: "none" })).toThrow(OfflineBillError);
    for (const q of [0, -1, 1.5, 100]) expect(() => priceOfflineBill(snap, [{ menuItemId: "momo", quantity: q }], { kind: "none" })).toThrow(/Quantity/);
    expect(() => priceOfflineBill(snap, [], { kind: "none" })).toThrow(/nothing to bill/);
    expect(() => priceOfflineBill(snap, Array.from({ length: 61 }, () => ({ menuItemId: "tea", quantity: 1 })), { kind: "none" })).toThrow(/at most 60/);
  });
  it("uses the dish's price from the snapshot whatever the phone claims", () => {
    // there is no way to give a price: only an id and a quantity
    const { totals } = priceOfflineBill(snap, [{ menuItemId: "tea", quantity: 1, ...({ price: 1 } as object) } as { menuItemId: string; quantity: number }], { kind: "none" });
    expect(totals.subtotal).toBe(8_000);
  });
});

describe("checkPayments and checkDiscount", () => {
  it("needs payments that add up exactly, in whole positive paisa, by a known method", () => {
    expect(() => checkPayments(100, [{ method: "CASH", amount: 100 }])).not.toThrow();
    expect(() => checkPayments(100, [{ method: "CASH", amount: 60 }, { method: "QR", amount: 40 }])).not.toThrow();
    expect(() => checkPayments(100, [])).toThrow(/how the bill was paid/);
    expect(() => checkPayments(100, [{ method: "CASH", amount: 99 }])).toThrow(/exactly/);
    expect(() => checkPayments(100, [{ method: "CASH", amount: 101 }])).toThrow(/exactly/);
    expect(() => checkPayments(100, [{ method: "CASH", amount: 150 }, { method: "QR", amount: -50 }])).toThrow(/positive/);
    expect(() => checkPayments(100, [{ method: "CASH", amount: 10.5 }])).toThrow(/positive/);
    expect(() => checkPayments(100, [{ method: "CREDIT" as "CASH", amount: 100 }])).toThrow(/cash, QR or card/);
  });
  it("keeps discounts sane", () => {
    expect(() => checkDiscount({ kind: "percent", bps: 1000 })).not.toThrow();
    expect(() => checkDiscount({ kind: "percent", bps: 10_001 })).toThrow(/0 to 100/);
    expect(() => checkDiscount({ kind: "percent", bps: -1 })).toThrow();
    expect(() => checkDiscount({ kind: "amount", amount: -5 })).toThrow(/negative/);
  });
});

describe("invoice numbers on the phone", () => {
  const blocks = [{ from: 101, to: 105 }, { from: 201, to: 203 }];
  it("hands out the lowest unused number and counts what is left", () => {
    expect(nextInvoiceNumber(blocks, new Set())).toBe(101);
    expect(nextInvoiceNumber(blocks, new Set([101, 102]))).toBe(103);
    expect(numbersLeft(blocks, new Set([101, 102]))).toBe(6);
  });
  it("moves on to the next block and says when it has run out", () => {
    expect(nextInvoiceNumber(blocks, new Set([101, 102, 103, 104, 105]))).toBe(201);
    expect(nextInvoiceNumber(blocks, new Set([101, 102, 103, 104, 105, 201, 202, 203]))).toBeNull();
    expect(nextInvoiceNumber([], new Set())).toBeNull();
    expect(numbersLeft([], new Set())).toBe(0);
  });
});

describe("billTimeProblem", () => {
  const now = new Date("2026-11-22T06:00:00Z");
  it("accepts a bill made after the menu was loaded and before now", () => {
    expect(billTimeProblem(snap, "2026-11-21T10:00:00Z", now)).toBeNull();
    expect(billTimeProblem(snap, "2026-11-22T06:03:00Z", now)).toBeNull(); // a little clock drift
  });
  it("refuses future, too-early, unreadable and stale-menu bills", () => {
    expect(billTimeProblem(snap, "2026-11-22T07:00:00Z", now)).toMatch(/future/);
    expect(billTimeProblem(snap, "2026-11-19T00:00:00Z", now)).toMatch(/before the menu/);
    expect(billTimeProblem(snap, "garbage", now)).toMatch(/no valid time/);
    expect(billTimeProblem(snap, "2026-12-25T00:00:00Z", new Date("2027-01-01T00:00:00Z"))).toMatch(/more than 30 days/);
  });
});
