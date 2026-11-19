import { describe, expect, it } from "vitest";
import { balanced, refundLines, saleLines, supplierBillLines, supplierPaymentLines } from "./postings";
import { balanceSheet, ledger, profitAndLoss, trialBalance, type AccountInfo, type PostedLine } from "./books";

describe("postings", () => {
  const sale = { grandTotal: 11_300, serviceCharge: 1_000, vat: 1_300, deliveryFee: 0, roundOff: 0, payments: [{ method: "CASH", amount: 5_000 }, { method: "QR", amount: 6_300 }] };
  it("a sale balances and splits into sales, service charge and VAT", () => {
    const l = saleLines(sale);
    expect(balanced(l)).toBe(true);
    expect(l.find((x) => x.key === "SALES")!.credit).toBe(9_000);
    expect(l.find((x) => x.key === "VAT_OUTPUT")!.credit).toBe(1_300);
    expect(l.find((x) => x.key === "WALLET")!.debit).toBe(6_300);
  });
  it("rounding either way still balances", () => {
    expect(balanced(saleLines({ ...sale, roundOff: -20, payments: [{ method: "CASH", amount: 11_300 }] }))).toBe(true);
    expect(balanced(saleLines({ ...sale, roundOff: 30, payments: [{ method: "CASH", amount: 11_300 }] }))).toBe(true);
  });
  it("an unpaid part is owed by the customer", () => {
    const l = saleLines({ ...sale, payments: [{ method: "CASH", amount: 1_000 }] });
    expect(balanced(l)).toBe(true);
    expect(l.find((x) => x.key === "RECEIVABLE")!.debit).toBe(10_300);
  });
  it("a refund reverses a sale", () => {
    const l = refundLines({ grandTotal: 11_300, serviceCharge: 1_000, vat: 1_300, roundOff: 0, refunds: [{ method: "CASH", amount: 11_300 }] });
    expect(balanced(l)).toBe(true);
    expect(l.find((x) => x.key === "SALES_RETURNS")!.debit).toBe(9_000);
  });
  it("supplier bills and payments balance", () => {
    expect(balanced(supplierBillLines(5_000))).toBe(true);
    expect(supplierPaymentLines(5_000, "CHEQUE").find((x) => x.credit)!.key).toBe("BANK");
  });
});

const A: AccountInfo[] = [
  { id: "cash", code: "1010", name: "Cash", type: "ASSET" },
  { id: "pay", code: "2010", name: "Payable", type: "LIABILITY" },
  { id: "cap", code: "3010", name: "Capital", type: "EQUITY" },
  { id: "sales", code: "4010", name: "Sales", type: "INCOME" },
  { id: "rent", code: "5200", name: "Rent", type: "EXPENSE" },
];
const L: PostedLine[] = [
  { accountId: "cash", date: "2026-08-01", debit: 100_000, credit: 0 },
  { accountId: "cap", date: "2026-08-01", debit: 0, credit: 100_000 },
  { accountId: "cash", date: "2026-08-02", debit: 30_000, credit: 0 },
  { accountId: "sales", date: "2026-08-02", debit: 0, credit: 30_000 },
  { accountId: "rent", date: "2026-08-03", debit: 10_000, credit: 0 },
  { accountId: "cash", date: "2026-08-03", debit: 0, credit: 10_000 },
];

describe("the books", () => {
  it("trial balance totals agree", () => {
    const t = trialBalance(A, L);
    expect(t.totalDebit).toBe(t.totalCredit);
    expect(t.rows.map((r) => r.account.id)).toEqual(["cash", "cap", "sales", "rent"]);
  });
  it("profit and loss", () => {
    const p = profitAndLoss(A, L);
    expect([p.income.total, p.expenses.total, p.profit]).toEqual([30_000, 10_000, 20_000]);
  });
  it("balance sheet balances, with profit inside equity", () => {
    const b = balanceSheet(A, L);
    expect(b.assets.total).toBe(120_000);
    expect(b.equityTotal).toBe(120_000);
    expect(b.difference).toBe(0);
  });
  it("ledger keeps a running balance", () => {
    const rows = [
      { entryId: "1", date: "2026-08-02", number: "2", narration: "", debit: 30_000, credit: 0 },
      { entryId: "2", date: "2026-08-03", number: "3", narration: "", debit: 0, credit: 10_000 },
    ];
    const g = ledger("ASSET", { debit: 100_000, credit: 0 }, rows);
    expect(g.broughtForward).toBe(100_000);
    expect(g.rows.map((r) => r.balance)).toEqual([130_000, 120_000]);
    expect(g.closing).toBe(120_000);
  });
});
