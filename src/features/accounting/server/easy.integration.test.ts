import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createOrder, addItem, previewBill, checkout } from "@/features/orders/server/service";
import { localDate } from "@/lib/business-day";
import { getBalanceSheet, getTrialBalance, reverseVoucher } from "./service";
import { addMoneyAccount, createEasyEntry, getCashBook, getEasyOptions, listMoneyAccounts, listTransactions } from "./easy";

const stamp = Date.now();
let n = 0;
let owner: TenantContext;
let manager: TenantContext;
let businessId: string;
let momo: string;
let today: string;
let cash: string;
let bank: string;
let rent: string;
let otherIncome: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `easy-${stamp}@it.test`, name: "Easy", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-easy-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId, name: "Food" } });
  momo = (await db.menuItem.create({ data: { businessId, categoryId: cat.id, name: "Momo", price: 20_000 } })).id;
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  manager = { ...base, role: "MANAGER" };
  today = localDate(new Date(), biz.timezone);
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.journalLine.deleteMany({ where: { businessId } });
  await db.journalEntry.deleteMany({ where: { businessId } });
  await db.account.deleteMany({ where: { businessId } });
  await db.printJob.deleteMany({ where: { businessId } });
  await db.payment.deleteMany({ where: { businessId } });
  await db.invoice.deleteMany({ where: { businessId } });
  await db.orderItem.deleteMany({ where: { businessId } });
  await db.order.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

const entry = (over: Partial<Parameters<typeof createEasyEntry>[1]>) => createEasyEntry(owner, { kind: "INCOME", date: today, amount: 100_000, moneyAccountId: cash, otherAccountId: otherIncome, ...over });

describe("money accounts", () => {
  it("starts with cash, bank, wallet and card, and the owner can add a bank", async () => {
    const o = await getEasyOptions(owner);
    expect(o.money.map((m) => m.key)).toEqual(expect.arrayContaining(["CASH", "BANK", "WALLET", "CARD"]));
    cash = o.money.find((m) => m.key === "CASH")!.id;
    bank = o.money.find((m) => m.key === "BANK")!.id;
    rent = o.expense.find((e) => e.code === "5200")!.id;
    otherIncome = o.income.find((i) => i.code === "4900")!.id;
    const added = await addMoneyAccount(owner, { name: "Nabil Bank" });
    expect(added.code).toBe("1060");
    expect(added.moneyAccount).toBe(true);
    expect((await addMoneyAccount(owner, { name: "Global IME" })).code).toBe("1061");
    await expect(addMoneyAccount(manager, { name: "x" })).rejects.toThrow(/owner/);
    await expect(addMoneyAccount(owner, { name: " " })).rejects.toThrow(/name/);
    expect((await listMoneyAccounts(owner)).length).toBe(6);
  });
});

describe("easy entries", () => {
  it("post to the books: income and expense move cash and profit, and everything still balances", async () => {
    await entry({ amount: 100_000, party: "Gift shop" });
    await entry({ kind: "EXPENSE", amount: 30_000, otherAccountId: rent, party: "Landlord" });
    const accounts = await listMoneyAccounts(owner);
    expect(accounts.find((a) => a.key === "CASH")!.balance).toBe(70_000);
    const tb = await getTrialBalance(owner, today);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect((await getBalanceSheet(owner, today)).difference).toBe(0);
  });

  it("move money between accounts, and settle what customers owe and what is owed", async () => {
    await entry({ kind: "TRANSFER", amount: 20_000, otherAccountId: bank });
    await entry({ kind: "PAYMENT_IN", amount: 5_000, otherAccountId: undefined, party: "Sita" });
    await entry({ kind: "PAYMENT_OUT", amount: 7_000, otherAccountId: undefined, party: "Fresh Veg" });
    const a = await listMoneyAccounts(owner);
    expect(a.find((x) => x.key === "BANK")!.balance).toBe(20_000);
    expect(a.find((x) => x.key === "CASH")!.balance).toBe(70_000 - 20_000 + 5_000 - 7_000);
    const tb = await getTrialBalance(owner, today);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("are refused with the wrong accounts, a bad amount or a future date", async () => {
    await expect(entry({ otherAccountId: rent })).rejects.toThrow(/income account/);
    await expect(entry({ kind: "EXPENSE", otherAccountId: otherIncome })).rejects.toThrow(/expense account/);
    await expect(entry({ moneyAccountId: rent })).rejects.toThrow(/cash, bank or wallet/);
    await expect(entry({ kind: "TRANSFER", otherAccountId: cash })).rejects.toThrow(/two different/);
    await expect(entry({ kind: "TRANSFER", otherAccountId: rent })).rejects.toThrow(/goes to/);
    await expect(entry({ amount: 0 })).rejects.toThrow(/above zero/);
    await expect(entry({ date: "2099-01-01" })).rejects.toThrow(/future/);
    await expect(entry({ kind: "GIFT" })).rejects.toThrow(/kind of entry/);
    await expect(createEasyEntry(manager, { kind: "INCOME", date: today, amount: 1, moneyAccountId: cash, otherAccountId: otherIncome })).rejects.toThrow(/owner/);
  });
});

describe("the transactions list", () => {
  it("shows each kind, with the six cards, and a sale made at the till", async () => {
    const order = await createOrder(owner, { type: "TAKEAWAY", idempotencyKey: `easy-${stamp}-${++n}` });
    await addItem(owner, order.id, { menuItemId: momo, quantity: 1 });
    const t = await previewBill(owner, order.id, { kind: "none" });
    await checkout(owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });

    const r = await listTransactions(owner, { from: today, to: today });
    const types = new Set(r.rows.map((x) => x.type));
    for (const k of ["SALES", "INCOME", "EXPENSE", "TRANSFER", "PAYMENT_IN", "PAYMENT_OUT"]) expect(types.has(k as never)).toBe(true);
    expect(r.cards).toMatchObject({ sales: t.grandTotal, income: 100_000, expenses: 30_000, paymentIn: 5_000, paymentOut: 7_000, purchase: 0 });
    const sale = r.rows.find((x) => x.type === "SALES")!;
    expect(sale.mode).toBe("Cash in hand");
    expect(sale.by).toBe("System");
    expect(r.rows.find((x) => x.type === "INCOME")).toMatchObject({ party: "Gift shop", by: "Easy" });
  });

  it("filters by kind, account and words, and a reversed entry is marked and counts for nothing", async () => {
    expect((await listTransactions(owner, { from: today, to: today, type: "EXPENSE" })).rows.every((x) => x.type === "EXPENSE")).toBe(true);
    const bankOnly = await listTransactions(owner, { from: today, to: today, moneyAccountId: bank });
    expect(bankOnly.rows.map((x) => x.type)).toEqual(["TRANSFER"]);
    expect((await listTransactions(owner, { from: today, to: today, q: "landlord" })).rows).toHaveLength(1);
    const income = (await listTransactions(owner, { from: today, to: today, type: "INCOME" })).rows[0]!;
    await reverseVoucher(owner, income.id, "entered by mistake");
    const after = await listTransactions(owner, { from: today, to: today });
    expect(after.rows.find((x) => x.id === income.id)!.reversed).toBe(true);
    expect(after.cards.income).toBe(0);
    expect((await listTransactions(owner, { from: today, to: today, status: "reversed" })).rows.map((x) => x.id)).toContain(income.id);
    await expect(listTransactions(owner, { from: "2026-02-01", to: "2026-01-01" })).rejects.toThrow(/start date/);
  });
});

describe("the cash book by account", () => {
  it("lists what came in and went out of each account, with opening and closing balances that agree with the ledger", async () => {
    const book = await getCashBook(owner, today, today);
    const cashName = book.accounts.find((a) => a.id === cash)!.id;
    expect(book.opening[cashName]).toBe(0);
    const rows = [...book.receipts, ...book.payments].map((r) => r.row);
    expect(rows).toEqual(expect.arrayContaining(["Net sales", "Payment in", "Expenses", "Payment out", "Transfer out", "Transfer in"]));
    for (const a of book.accounts) {
      const live = (await listMoneyAccounts(owner)).find((m) => m.id === a.id)!;
      expect(book.closing[a.id]).toBe(live.balance);
    }
    expect(book.receiptsTotal.all).toBeGreaterThan(0);
  });
});
