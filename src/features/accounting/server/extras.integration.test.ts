import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createSupplier } from "@/features/purchasing/server/service";
import { createBill, recordBillPayment } from "@/features/purchasing/server/bills";
import { localDate } from "@/lib/business-day";
import { fiscalYearOf } from "../fiscal";
import { createVoucher, getBalanceSheet, getLedger, getProfitAndLoss, getTrialBalance, listAccounts, syncPostings } from "./service";
import {
  addAsset,
  closeYear,
  disposeAsset,
  getBudgetReport,
  getReconciliation,
  getTdsReport,
  listAssets,
  listClosedYears,
  markReconciled,
  reopenYear,
  runDepreciation,
  saveBudgets,
  saveOpeningBalances,
  unmatchLine,
} from "./extras";

const stamp = Date.now();
let owner: TenantContext;
let manager: TenantContext;
let businessId: string;
let today: string;
const PAST = "2026-01-10"; // inside fiscal year 2082/83, which has ended

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `ext-${stamp}@it.test`, name: "Ext", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-ext-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  manager = { ...base, role: "MANAGER" };
  today = localDate(new Date(), biz.timezone);
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.budget.deleteMany({ where: { businessId } });
  await db.fixedAssetDepreciation.deleteMany({ where: { businessId } });
  await db.fixedAsset.deleteMany({ where: { businessId } });
  await db.payrollLine.deleteMany({ where: { businessId } });
  await db.payrollRun.deleteMany({ where: { businessId } });
  await db.journalLine.deleteMany({ where: { businessId } });
  await db.journalEntry.deleteMany({ where: { businessId } });
  await db.account.deleteMany({ where: { businessId } });
  await db.supplierPayment.deleteMany({ where: { businessId } });
  await db.supplierBill.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

const acct = async (k: string) => (await db.account.findFirstOrThrow({ where: { businessId, key: k } })).id;
const byCode = async (code: string) => (await db.account.findFirstOrThrow({ where: { businessId, code } })).id;

describe("opening balances", () => {
  it("records what was owned and owed, balancing against profit brought forward", async () => {
    await listAccounts(owner);
    const cash = await acct("CASH");
    const payable = await acct("PAYABLE");
    const v = await saveOpeningBalances(owner, { date: PAST, rows: [{ accountId: cash, debit: 500_000, credit: 0 }, { accountId: payable, debit: 0, credit: 200_000 }] });
    expect(v.voucher).toBe("OPENING");
    const tb = await getTrialBalance(owner, today);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect((await getBalanceSheet(owner, today)).equity.rows[0]!.amount).toBe(300_000);
    await expect(saveOpeningBalances(owner, { date: PAST, rows: [] })).rejects.toThrow(/at least one/);
  });
});

describe("closing a fiscal year", () => {
  it("moves profit to profit brought forward, locks the year, and can be reopened", async () => {
    const cash = await acct("CASH");
    const other = await byCode("4900");
    const rent = await byCode("5200");
    await createVoucher(owner, { voucher: "RECEIPT", date: PAST, narration: "Other income", lines: [{ accountId: cash, debit: 90_000, credit: 0 }, { accountId: other, debit: 0, credit: 90_000 }] });
    await createVoucher(owner, { voucher: "PAYMENT", date: PAST, narration: "Rent", lines: [{ accountId: rent, debit: 30_000, credit: 0 }, { accountId: cash, debit: 0, credit: 30_000 }] });
    const fy = fiscalYearOf(PAST);
    await expect(closeYear(owner, fiscalYear(today))).rejects.toThrow(/after it has ended/);
    const r = await closeYear(owner, fy);
    expect(r.profit).toBe(60_000);
    // The year's own profit and loss is unchanged by closing it, and the balance sheet still balances.
    const pnl = await getProfitAndLoss(owner, "2026-01-01", "2026-07-16");
    expect(pnl.profit).toBe(60_000);
    expect((await getBalanceSheet(owner, today)).difference).toBe(0);
    expect((await listClosedYears(owner)).map((c) => c.fiscalYear)).toEqual([fy]);
    await expect(closeYear(owner, fy)).rejects.toThrow(/already closed/);
    await expect(createVoucher(owner, { voucher: "JOURNAL", date: PAST, narration: "late", lines: [{ accountId: rent, debit: 1, credit: 0 }, { accountId: cash, debit: 0, credit: 1 }] })).rejects.toThrow(/closed/);

    await reopenYear(owner, fy);
    expect(await listClosedYears(owner)).toHaveLength(0);
    expect((await getProfitAndLoss(owner, "2026-01-01", "2026-07-16")).profit).toBe(60_000);
    expect((await getBalanceSheet(owner, today)).difference).toBe(0);
    await createVoucher(owner, { voucher: "JOURNAL", date: PAST, narration: "now allowed", lines: [{ accountId: rent, debit: 1, credit: 0 }, { accountId: cash, debit: 0, credit: 1 }] });
    // Closed again, then a late supplier bill dated inside the year is posted on the first open day instead.
    await closeYear(owner, fy);
    const s = await createSupplier(owner, { name: "Late Supplier" });
    await createBill(owner, { supplierId: s.id, billDate: PAST, amount: 40_000 });
    await syncPostings(businessId);
    const late = await db.journalEntry.findFirstOrThrow({ where: { businessId, voucher: "PURCHASE" } });
    expect(late.date > "2026-07-16").toBe(true);
    await reopenYear(owner, fy);
  });
});

function fiscalYear(d: string) {
  return fiscalYearOf(d);
}

describe("tax deducted at source", () => {
  it("is kept back from the supplier, owed to IRD, and listed by Nepali month", async () => {
    const s = await createSupplier(owner, { name: "Landlord", panNumber: "123123123" });
    const bill = await createBill(owner, { supplierId: s.id, number: "R-1", billDate: today, amount: 100_000, tdsAmount: 10_000 });
    await expect(recordBillPayment(owner, bill.id, { amount: 90_001, method: "BANK", paidOn: today })).rejects.toThrow(/still owed/);
    await recordBillPayment(owner, bill.id, { amount: 90_000, method: "BANK", paidOn: today });
    await syncPostings(businessId);
    expect((await getLedger(owner, await acct("TDS_PAYABLE"), today, today)).closing).toBe(10_000);
    const tds = await getTdsReport(owner, today, today);
    expect(tds.total).toBe(10_000);
    expect(tds.months[0]!.rows[0]).toMatchObject({ supplier: "Landlord", pan: "123123123", tds: 10_000 });
    expect(tds.months[0]!.dueBy).toMatch(/^25 /);
    await expect(createBill(owner, { supplierId: s.id, billDate: today, amount: 1_000, tdsAmount: 1_000 })).rejects.toThrow(/less than the bill total/);
  });
});

describe("bank reconciliation", () => {
  it("ticks off lines once, shows what is left, and can undo", async () => {
    const bank = await acct("BANK");
    const before = await getReconciliation(owner, bank, today);
    expect(before.open.length).toBeGreaterThan(0);
    const ids = before.open.map((l) => l.id);
    expect(await markReconciled(owner, bank, today, ids)).toBe(ids.length);
    const after = await getReconciliation(owner, bank, today);
    expect(after.open).toHaveLength(0);
    expect(after.matchedBalance).toBe(after.bookBalance);
    expect(await markReconciled(owner, bank, today, ids).catch(() => -1)).toBe(0);
    await unmatchLine(owner, bank, ids[0]!);
    expect((await getReconciliation(owner, bank, today)).open).toHaveLength(1);
    await expect(markReconciled(manager, bank, today, ids)).rejects.toThrow(/owner/);
  });
});

describe("payroll in the books", () => {
  it("posts wages when a payroll is made and the payment when it is paid", async () => {
    const run = await db.payrollRun.create({ data: { businessId, periodStart: "2026-11-01", periodEnd: "2026-11-15" } });
    const line = await db.payrollLine.create({ data: { businessId, runId: run.id, userId: owner.userId, name: "Sita", payType: "HOURLY", rate: 100, netPay: 700_000 } });
    await syncPostings(businessId);
    expect((await getLedger(owner, await acct("SALARY_PAYABLE"), "2026-11-01", today)).closing).toBe(700_000);
    await db.payrollLine.update({ where: { id: line.id }, data: { paidAt: new Date(), paidMethod: "Bank transfer" } });
    await syncPostings(businessId);
    expect((await getLedger(owner, await acct("SALARY_PAYABLE"), "2026-11-01", today)).closing).toBe(0);
    const tb = await getTrialBalance(owner, today);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
});

describe("fixed assets and depreciation", () => {
  it("buys an asset, depreciates it once a year, and stops when it is sold", async () => {
    const oven = await addAsset(owner, { name: "Pizza oven", cost: 1_000_000, purchaseDate: "2025-01-01", rateBps: 2_000, paidFrom: "BANK" });
    await expect(addAsset(owner, { name: "x", cost: 1, purchaseDate: "2099-01-01", rateBps: 1_000, paidFrom: "CASH" })).rejects.toThrow(/future/);
    const fy = fiscalYearOf(today);
    const first = await runDepreciation(owner, fy);
    expect(first.count).toBeGreaterThanOrEqual(1);
    expect((await runDepreciation(owner, fy)).total).toBe(0); // charged once a year
    const assets = await listAssets(owner);
    const o = assets.find((a) => a.id === oven.id)!;
    expect(o.accumulated).toBeGreaterThan(0);
    expect(o.bookValue).toBe(1_000_000 - o.accumulated);
    const bs = await getBalanceSheet(owner, today);
    expect(bs.difference).toBe(0);
    await disposeAsset(owner, oven.id, today);
    await expect(disposeAsset(owner, oven.id, today)).rejects.toThrow(/already/);
    await expect(runDepreciation(owner, "2099/00")).rejects.toThrow(/not started|Choose a fiscal year/);
  });
});

describe("budgets", () => {
  it("compares plan to actual, with a positive variance when things went better", async () => {
    const fy = fiscalYearOf(today);
    const rent = await byCode("5200");
    const other = await byCode("4900");
    await saveBudgets(owner, fy, [{ accountId: rent, amount: 50_000 }, { accountId: other, amount: 100_000 }]);
    await createVoucher(owner, { voucher: "RECEIPT", date: today, narration: "x", lines: [{ accountId: await acct("CASH"), debit: 60_000, credit: 0 }, { accountId: other, debit: 0, credit: 60_000 }] });
    const rows = await getBudgetReport(owner, fy);
    const inc = rows.find((r) => r.account.id === other)!;
    expect([inc.budget, inc.actual, inc.variance]).toEqual([100_000, 60_000, -40_000]);
    const exp = rows.find((r) => r.account.id === rent)!;
    expect([exp.budget, exp.actual, exp.variance]).toEqual([50_000, 0, 50_000]);
    await expect(saveBudgets(owner, fy, [{ accountId: await acct("CASH"), amount: 1 }])).rejects.toThrow(/income and expense/);
    await saveBudgets(owner, fy, [{ accountId: rent, amount: 0 }]);
    expect((await getBudgetReport(owner, fy)).find((r) => r.account.id === rent)!.budget).toBe(0);
  });
});
