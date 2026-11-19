import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createOrder, addItem, previewBill, checkout } from "@/features/orders/server/service";
import { refundInvoice } from "@/features/orders/server/void";
import { createSupplier } from "@/features/purchasing/server/service";
import { createBill, recordBillPayment, voidBill } from "@/features/purchasing/server/bills";
import { localDate } from "@/lib/business-day";
import {
  createAccount,
  createVoucher,
  getBalanceSheet,
  getDaybook,
  getLedger,
  getProfitAndLoss,
  getTrialBalance,
  listAccounts,
  reverseVoucher,
  syncPostings,
  updateAccount,
} from "./service";

const stamp = Date.now();
let n = 0;
const key = () => `acc-${stamp}-${++n}`;
let owner: TenantContext;
let manager: TenantContext;
let cashier: TenantContext;
let businessId: string;
let momo: string;
let today: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `acc-${stamp}@it.test`, name: "Acc", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-acc-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId, name: "Food" } });
  momo = (await db.menuItem.create({ data: { businessId, categoryId: cat.id, name: "Momo", price: 20_000 } })).id;
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  manager = { ...base, role: "MANAGER" };
  cashier = { ...base, role: "CASHIER" };
  today = localDate(new Date(), biz.timezone);
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.journalLine.deleteMany({ where: { businessId } });
  await db.journalEntry.deleteMany({ where: { businessId } });
  await db.account.deleteMany({ where: { businessId } });
  await db.supplierPayment.deleteMany({ where: { businessId } });
  await db.supplierBill.deleteMany({ where: { businessId } });
  await db.printJob.deleteMany({ where: { businessId } });
  await db.payment.deleteMany({ where: { businessId } });
  await db.refundPayment.deleteMany({ where: { businessId } });
  await db.creditNote.deleteMany({ where: { businessId } });
  await db.invoice.deleteMany({ where: { businessId } });
  await db.orderItemAddOn.deleteMany({ where: { businessId } });
  await db.orderItem.deleteMany({ where: { businessId } });
  await db.order.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

async function sale() {
  const order = await createOrder(owner, { type: "TAKEAWAY", idempotencyKey: key() });
  await addItem(owner, order.id, { menuItemId: momo, quantity: 2 });
  const t = await previewBill(owner, order.id, { kind: "none" });
  const inv = await checkout(owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
  return { inv, total: t.grandTotal };
}

const acct = async (k: string) => (await db.account.findFirstOrThrow({ where: { businessId, key: k } })).id;

describe("the accounting books", () => {
  it("starts every business with the standard chart", async () => {
    const accounts = await listAccounts(owner);
    expect(accounts.length).toBeGreaterThan(20);
    expect(accounts.find((a) => a.key === "VAT_OUTPUT")).toBeTruthy();
  });

  it("posts a paid bill once, and the books balance", async () => {
    const { inv, total } = await sale();
    expect(await syncPostings(businessId)).toBeGreaterThanOrEqual(1);
    expect(await syncPostings(businessId)).toBe(0); // posting again changes nothing
    const entries = await db.journalEntry.findMany({ where: { businessId, sourceKind: "SALE", sourceId: inv.id }, include: { lines: true } });
    expect(entries).toHaveLength(1);
    const lines = entries[0]!.lines;
    expect(lines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
    expect(lines.find((l) => l.accountId === undefined)).toBeUndefined();
    const cash = await getLedger(owner, await acct("CASH"), today, today);
    expect(cash.rows.at(-1)!.debit).toBe(total);
    const tb = await getTrialBalance(owner, today);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    const bs = await getBalanceSheet(owner, today);
    expect(bs.difference).toBe(0);
  });

  it("a refund takes the sale back", async () => {
    const { inv } = await sale();
    await syncPostings(businessId);
    const before = await getProfitAndLoss(owner, today, today);
    await refundInvoice(owner, inv.id, "customer unhappy");
    const after = await getProfitAndLoss(owner, today, today);
    expect(after.profit).toBeLessThan(before.profit);
    const tb = await getTrialBalance(owner, today);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("supplier bills and payments are posted, and a voided bill is reversed", async () => {
    const s = await createSupplier(owner, { name: "Fresh Veg" });
    const bill = await createBill(owner, { supplierId: s.id, billDate: today, amount: 500_000 });
    await recordBillPayment(owner, bill.id, { amount: 200_000, method: "CASH", paidOn: today });
    await syncPostings(businessId);
    const payable = await getLedger(owner, await acct("PAYABLE"), today, today);
    expect(payable.closing).toBe(300_000);
    const other = await createBill(owner, { supplierId: s.id, billDate: today, amount: 100_000 });
    await syncPostings(businessId);
    await voidBill(owner, other.id, "entered twice");
    await syncPostings(businessId);
    expect((await getLedger(owner, await acct("PAYABLE"), today, today)).closing).toBe(300_000);
    const day = await getDaybook(owner, today, today);
    expect(day.entries.some((e) => e.voucher === "REVERSAL")).toBe(true);
  });

  it("an owner can type a voucher, and it must balance", async () => {
    const rent = (await createAccount(owner, { code: "5210", name: "Shop rent", type: "EXPENSE" })).id;
    const cash = await acct("CASH");
    await expect(createVoucher(owner, { voucher: "PAYMENT", date: today, narration: "Rent", lines: [{ accountId: rent, debit: 1000, credit: 0 }, { accountId: cash, debit: 0, credit: 900 }] })).rejects.toThrow(/equal/);
    const v = await createVoucher(owner, { voucher: "PAYMENT", date: today, narration: "Rent for the month", lines: [{ accountId: rent, debit: 1_000_00, credit: 0 }, { accountId: cash, debit: 0, credit: 1_000_00 }] });
    expect(v.number).toBeGreaterThan(0);
    const pnl = await getProfitAndLoss(owner, today, today);
    expect(pnl.expenses.rows.find((r) => r.account.id === rent)!.amount).toBe(1_000_00);
    await expect(createVoucher(owner, { voucher: "PAYMENT", date: "2099-01-01", narration: "x", lines: [{ accountId: rent, debit: 1, credit: 0 }, { accountId: cash, debit: 0, credit: 1 }] })).rejects.toThrow(/future/);
  });

  it("a mistake is reversed, once, never deleted", async () => {
    const rent = (await db.account.findFirstOrThrow({ where: { businessId, code: "5210" } })).id;
    const cash = await acct("CASH");
    const v = await createVoucher(owner, { voucher: "JOURNAL", date: today, narration: "Wrong", lines: [{ accountId: rent, debit: 500, credit: 0 }, { accountId: cash, debit: 0, credit: 500 }] });
    await reverseVoucher(owner, v.id, "typed twice");
    await expect(reverseVoucher(owner, v.id, "again")).rejects.toThrow(/already/);
    expect(await db.journalEntry.count({ where: { id: v.id } })).toBe(1);
    const tb = await getTrialBalance(owner, today);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("system entries cannot be reversed by hand, and numbers have no gaps", async () => {
    const sys = await db.journalEntry.findFirstOrThrow({ where: { businessId, voucher: "SALE" } });
    await expect(reverseVoucher(owner, sys.id, "oops")).rejects.toThrow(/Correct it there/);
    const all = await db.journalEntry.findMany({ where: { businessId }, select: { fiscalYear: true, number: true } });
    for (const fy of new Set(all.map((e) => e.fiscalYear))) {
      const nums = all.filter((e) => e.fiscalYear === fy).map((e) => e.number).sort((a, b) => a - b);
      expect(nums).toEqual(nums.map((_, i) => i + 1));
    }
  });

  it("who may see and change the books", async () => {
    await expect(listAccounts(cashier)).rejects.toThrow(/permission/);
    expect((await listAccounts(manager)).length).toBeGreaterThan(0);
    await expect(createAccount(manager, { code: "9999", name: "X", type: "EXPENSE" })).rejects.toThrow(/owner/);
    const cashAcc = await acct("CASH");
    await expect(updateAccount(owner, cashAcc, { active: false })).rejects.toThrow(/cannot be switched off/);
  });
});
