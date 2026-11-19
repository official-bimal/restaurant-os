import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { localDate } from "@/lib/business-day";
import { createVoucher, listAccounts, reverseVoucher } from "./service";
import { createEasyEntry, getEasyOptions, listTransactions } from "./easy";
import { buildExport, EXPORT_KINDS } from "./exports";
import { saveOpeningBalances, closeYear } from "./extras";

const stamp = Date.now();
let owner: TenantContext;
let accountant: TenantContext;
let businessId: string;
let today: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `acct-${stamp}@it.test`, name: "Acct", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-acct-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  accountant = { ...base, role: "ACCOUNTANT" };
  today = localDate(new Date(), biz.timezone);
  const o = await getEasyOptions(owner);
  await createEasyEntry(owner, { kind: "INCOME", date: today, amount: 150_000, moneyAccountId: o.money[0]!.id, otherAccountId: o.income[0]!.id, party: "=cmd|' /C calc'!A0" });
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.journalLine.deleteMany({ where: { businessId } });
  await db.journalEntry.deleteMany({ where: { businessId } });
  await db.account.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

describe("the accountant role", () => {
  it("can read the books and bills and reports, and nothing else", () => {
    for (const p of ["books.view", "report.view", "bills.view"] as const) expect(can("ACCOUNTANT", p)).toBe(true);
    for (const p of ["books.manage", "order.create", "order.edit", "bill.checkout", "bill.refund", "menu.manage", "stock.manage", "staff.manage", "payroll.manage", "owner.control", "branch.manage", "day.close", "drawer.use", "kitchen.update"] as const) {
      expect(can("ACCOUNTANT", p)).toBe(false);
    }
  });

  it("reads every book and can download each one as a CSV", async () => {
    expect((await listAccounts(accountant)).length).toBeGreaterThan(20);
    expect((await listTransactions(accountant, { from: today, to: today })).rows).toHaveLength(1);
    const cash = (await listAccounts(accountant)).find((a) => a.key === "CASH")!;
    for (const kind of EXPORT_KINDS) {
      const { filename, csv } = await buildExport(accountant, kind, { from: today, to: today, account: cash.id });
      expect(filename).toMatch(/\.csv$/);
      expect(csv.split("\r\n")[0]!.length).toBeGreaterThan(3);
    }
  });

  it("writes money as numbers and defuses formulas typed by someone else", async () => {
    const t = await buildExport(accountant, "transactions", { from: today, to: today });
    expect(t.csv).toContain(",1500,"); // Rs 1,500 as a plain number
    expect(t.csv).toContain("'=cmd|"); // the formula-looking name is made harmless
    expect(t.csv).not.toMatch(/(^|,)=cmd/);
    const tb = await buildExport(accountant, "trial-balance", { from: today, to: today });
    expect(tb.filename).toBe(`trial-balance-as-at-${today}.csv`);
  });

  it("cannot change anything", async () => {
    const o = await getEasyOptions(accountant);
    await expect(createEasyEntry(accountant, { kind: "INCOME", date: today, amount: 1, moneyAccountId: o.money[0]!.id, otherAccountId: o.income[0]!.id })).rejects.toThrow(/owner/);
    await expect(createVoucher(accountant, { voucher: "JOURNAL", date: today, narration: "x", lines: [] })).rejects.toThrow(/owner/);
    await expect(reverseVoucher(accountant, "x", "y")).rejects.toThrow(/owner/);
    await expect(saveOpeningBalances(accountant, { date: today, rows: [] })).rejects.toThrow(/owner/);
    await expect(closeYear(accountant, "2082/83")).rejects.toThrow(/owner/);
  });

  it("refuses an unknown export and bad dates", async () => {
    await expect(buildExport(accountant, "passwords", { from: today, to: today })).rejects.toThrow(/Unknown export/);
    await expect(buildExport(accountant, "sales", { from: "nope", to: today })).rejects.toThrow(/valid dates/);
    await expect(buildExport(accountant, "ledger", { from: today, to: today })).rejects.toThrow(/Choose an account/);
  });
});
