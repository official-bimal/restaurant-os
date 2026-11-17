import { describe, expect, it } from "vitest";
import { buildReport, type InvoiceInput, type ReportInput } from "./report";

const inv = (n: number, total: number, payments: InvoiceInput["payments"], over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  number: n,
  subtotal: Math.round(total / 1.243),
  discount: 0,
  loyaltyDiscount: 0,
  serviceCharge: 0,
  vat: Math.round(total * 0.1),
  roundOff: 0,
  grandTotal: total,
  orderType: "DINE_IN",
  payments,
  ...over,
});

const empty: ReportInput = { invoices: [], creditNotes: [], items: [], cancelled: [] };

describe("buildReport", () => {
  it("is all zeros for a quiet day", () => {
    const r = buildReport(empty);
    expect(r.sales).toMatchObject({ count: 0, gross: 0, average: 0 });
    expect(r.net).toBe(0);
    expect(r.expectedCash).toBe(0);
    expect(r.topItems).toEqual([]);
    expect(r.byMethod.CASH).toEqual({ sales: 0, refunds: 0, net: 0 });
  });

  it("adds up sales, splits by payment method, and averages", () => {
    const r = buildReport({
      ...empty,
      invoices: [
        inv(1, 47_000, [{ method: "CASH", amount: 30_000 }, { method: "QR", amount: 17_000 }]),
        inv(2, 124_300, [{ method: "CASH", amount: 124_300 }], { orderType: "TAKEAWAY" }),
      ],
    });
    expect(r.sales.count).toBe(2);
    expect(r.sales.gross).toBe(171_300);
    expect(r.sales.average).toBe(85_650);
    expect(r.byMethod.CASH.sales).toBe(154_300);
    expect(r.byMethod.QR.sales).toBe(17_000);
    expect(r.byMethod.CARD.sales).toBe(0);
    expect(r.byType).toEqual([
      { type: "TAKEAWAY", count: 1, total: 124_300 },
      { type: "DINE_IN", count: 1, total: 47_000 },
    ]);
  });

  it("subtracts refunds, by method, and from expected cash", () => {
    const r = buildReport({
      ...empty,
      invoices: [inv(1, 100_000, [{ method: "CASH", amount: 60_000 }, { method: "QR", amount: 40_000 }])],
      creditNotes: [
        { number: 1, invoiceNumber: 9, grandTotal: 30_000, vat: 3_000, reason: "Wrong order", refunds: [{ method: "CASH", amount: 30_000 }] },
      ],
    });
    expect(r.net).toBe(70_000);
    expect(r.refunds).toEqual({ count: 1, total: 30_000, vat: 3_000 });
    expect(r.byMethod.CASH).toEqual({ sales: 60_000, refunds: 30_000, net: 30_000 });
    expect(r.expectedCash).toBe(30_000);
    expect(r.netVat).toBe(10_000 - 3_000);
    expect(r.refundList).toEqual([{ number: 1, invoiceNumber: 9, total: 30_000, reason: "Wrong order" }]);
  });

  it("can show a negative day when refunds of earlier sales exceed today's", () => {
    const r = buildReport({
      ...empty,
      creditNotes: [{ number: 1, invoiceNumber: 1, grandTotal: 50_000, vat: 0, reason: "Old bill", refunds: [{ method: "CASH", amount: 50_000 }] }],
    });
    expect(r.net).toBe(-50_000);
    expect(r.expectedCash).toBe(-50_000);
  });

  it("ranks items by revenue, merges lines, and counts complimentary items as free", () => {
    const r = buildReport({
      ...empty,
      items: [
        { name: "Momo", quantity: 2, unitPrice: 20_000, complimentary: false },
        { name: "Momo", quantity: 1, unitPrice: 20_000, complimentary: false },
        { name: "Tea", quantity: 10, unitPrice: 5_000, complimentary: false },
        { name: "Soup", quantity: 3, unitPrice: 9_000, complimentary: true },
      ],
    });
    expect(r.topItems.map((i) => [i.name, i.quantity, i.revenue])).toEqual([
      ["Momo", 3, 60_000],
      ["Tea", 10, 50_000],
      ["Soup", 3, 0],
    ]);
  });

  it("keeps only the ten best items", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ name: `Dish ${i}`, quantity: 1, unitPrice: 1_000 + i, complimentary: false }));
    expect(buildReport({ ...empty, items }).topItems).toHaveLength(10);
  });

  it("reports food cost and its share of the sales price of dishes with a recipe", () => {
    const r = buildReport({
      ...empty,
      invoices: [inv(1, 124_300, [{ method: "CASH", amount: 124_300 }], { subtotal: 100_000, discount: 10_000, loyaltyDiscount: 5_000 })],
      foodCost: 25_500,
      recipeSales: 85_000,
    });
    expect(r.foodCost).toBe(25_500);
    expect(r.foodCostPercent).toBe(30); // 25,500 of 85,000
    expect(buildReport(empty)).toMatchObject({ foodCost: 0, foodCostPercent: null });
    expect(buildReport({ ...empty, invoices: [inv(1, 100, [{ method: "CASH", amount: 100 }])] }).foodCostPercent).toBeNull(); // no recipes used
  });

  it("lists cancelled orders", () => {
    const r = buildReport({ ...empty, cancelled: [{ number: 7, reason: "Walked out", itemCount: 3 }] });
    expect(r.cancelled).toEqual({ count: 1, orders: [{ number: 7, reason: "Walked out", itemCount: 3 }] });
  });

  it("payment methods always add up to gross sales when payments match the invoices", () => {
    const r = buildReport({
      ...empty,
      invoices: [inv(1, 12_300, [{ method: "CARD", amount: 12_300 }]), inv(2, 45_000, [{ method: "CASH", amount: 45_000 }])],
    });
    const sales = Object.values(r.byMethod).reduce((s, m) => s + m.sales, 0);
    expect(sales).toBe(r.sales.gross);
  });
});
