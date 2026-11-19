import { describe, expect, it } from "vitest";
import { balanced } from "./postings";
import { cardTotals, cashBookRow, classify, easyLines, voucherFor, type TxRow } from "./transactions";

describe("what kind of transaction a voucher is", () => {
  it("reads the easy entries first, then how the system made it", () => {
    expect(classify({ voucher: "RECEIPT", entryKind: "INCOME" })).toBe("INCOME");
    expect(classify({ voucher: "PAYMENT", entryKind: "PAYMENT_OUT" })).toBe("PAYMENT_OUT");
    expect(classify({ voucher: "SALE", entryKind: null })).toBe("SALES");
    expect(classify({ voucher: "REFUND", entryKind: null })).toBe("SALES_RETURN");
    expect(classify({ voucher: "PURCHASE", entryKind: null })).toBe("PURCHASE");
    expect(classify({ voucher: "SUPPLIER_PAYMENT", entryKind: null })).toBe("PAYMENT_OUT");
    expect(classify({ voucher: "SALARY_PAID", entryKind: null })).toBe("PAYMENT_OUT");
    expect(classify({ voucher: "PAYROLL", entryKind: null })).toBe("EXPENSE");
    expect(classify({ voucher: "JOURNAL", entryKind: null })).toBe("JOURNAL");
    expect(classify({ voucher: "DEPRECIATION", entryKind: null })).toBe("JOURNAL");
    expect(classify({ voucher: "JOURNAL", entryKind: "nonsense" })).toBe("JOURNAL");
  });
});

describe("easy entries", () => {
  const i = { amount: 5_000, money: "cash", other: "x", to: "bank" };
  it("post the right accounts and always balance", () => {
    expect(easyLines("INCOME", i)).toEqual([{ accountId: "cash", debit: 5_000, credit: 0 }, { accountId: "x", debit: 0, credit: 5_000 }]);
    expect(easyLines("EXPENSE", i)).toEqual([{ accountId: "x", debit: 5_000, credit: 0 }, { accountId: "cash", debit: 0, credit: 5_000 }]);
    expect(easyLines("PAYMENT_IN", i)[0]).toMatchObject({ accountId: "cash", debit: 5_000 });
    expect(easyLines("PAYMENT_OUT", i)[1]).toMatchObject({ accountId: "cash", credit: 5_000 });
    expect(easyLines("TRANSFER", i)).toEqual([{ accountId: "bank", debit: 5_000, credit: 0 }, { accountId: "cash", debit: 0, credit: 5_000 }]);
    for (const k of ["INCOME", "EXPENSE", "PAYMENT_IN", "PAYMENT_OUT", "TRANSFER"] as const) expect(balanced(easyLines(k, i))).toBe(true);
  });
  it("are kept under the usual voucher kinds", () => {
    expect(voucherFor("INCOME")).toBe("RECEIPT");
    expect(voucherFor("PAYMENT_IN")).toBe("RECEIPT");
    expect(voucherFor("EXPENSE")).toBe("PAYMENT");
    expect(voucherFor("PAYMENT_OUT")).toBe("PAYMENT");
    expect(voucherFor("TRANSFER")).toBe("CONTRA");
  });
});

describe("the six cards", () => {
  const rows: TxRow[] = [
    { type: "SALES", amount: 10_000, reversed: false },
    { type: "SALES", amount: 5_000, reversed: false },
    { type: "SALES_RETURN", amount: 2_000, reversed: false },
    { type: "PURCHASE", amount: 4_000, reversed: false },
    { type: "INCOME", amount: 700, reversed: false },
    { type: "INCOME", amount: 900, reversed: true },
    { type: "EXPENSE", amount: 1_100, reversed: false },
    { type: "PAYMENT_IN", amount: 300, reversed: false },
    { type: "PAYMENT_OUT", amount: 1_500, reversed: false },
    { type: "TRANSFER", amount: 9_999, reversed: false },
    { type: "JOURNAL", amount: 9_999, reversed: false },
  ];
  it("add up each kind, take returns off sales, and leave out reversed entries, transfers and journals", () => {
    expect(cardTotals(rows)).toEqual({ sales: 13_000, purchase: 4_000, income: 700, expenses: 1_100, paymentIn: 300, paymentOut: 1_500 });
  });
});

describe("cash book rows", () => {
  it("names where money came from and went to", () => {
    expect(cashBookRow("SALES", "IN")).toBe("Net sales");
    expect(cashBookRow("TRANSFER", "IN")).toBe("Transfer in");
    expect(cashBookRow("TRANSFER", "OUT")).toBe("Transfer out");
    expect(cashBookRow("SALES_RETURN", "OUT")).toBe("Sales return");
    expect(cashBookRow("PAYMENT_OUT", "OUT")).toBe("Payment out");
    expect(cashBookRow("JOURNAL", "IN")).toBe("Other receipts");
    expect(cashBookRow("JOURNAL", "OUT")).toBe("Other payments");
  });
});
