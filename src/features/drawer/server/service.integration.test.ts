import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createOrder, addItem, previewBill, checkout } from "@/features/orders/server/service";
import { refundInvoice } from "@/features/orders/server/void";
import { getTrialBalance, getLedger, syncPostings } from "@/features/accounting/server/service";
import { localDate } from "@/lib/business-day";
import { addMovement, closeShift, getDrawer, openShift } from "./service";

const stamp = Date.now();
let n = 0;
let owner: TenantContext;
let cashier: TenantContext;
let waiter: TenantContext;
let businessId: string;
let momo: string;
let today: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `dr-${stamp}@it.test`, name: "Dr", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-dr-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId, name: "Food" } });
  momo = (await db.menuItem.create({ data: { businessId, categoryId: cat.id, name: "Momo", price: 20_000 } })).id;
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  cashier = { ...base, role: "CASHIER" };
  waiter = { ...base, role: "WAITER" };
  today = localDate(new Date(), biz.timezone);
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.journalLine.deleteMany({ where: { businessId } });
  await db.journalEntry.deleteMany({ where: { businessId } });
  await db.account.deleteMany({ where: { businessId } });
  await db.cashMovement.deleteMany({ where: { businessId } });
  await db.cashShift.deleteMany({ where: { businessId } });
  await db.printJob.deleteMany({ where: { businessId } });
  await db.refundPayment.deleteMany({ where: { businessId } });
  await db.creditNote.deleteMany({ where: { businessId } });
  await db.payment.deleteMany({ where: { businessId } });
  await db.invoice.deleteMany({ where: { businessId } });
  await db.orderItem.deleteMany({ where: { businessId } });
  await db.order.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

async function cashSale(qty = 1) {
  const o = await createOrder(cashier, { type: "TAKEAWAY", idempotencyKey: `dr-${stamp}-${++n}` });
  await addItem(cashier, o.id, { menuItemId: momo, quantity: qty });
  const t = await previewBill(cashier, o.id, { kind: "none" });
  const inv = await checkout(cashier, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
  return { inv, total: t.grandTotal };
}

describe("the cash drawer", () => {
  it("must be opened first, and only one shift can be open", async () => {
    await expect(addMovement(cashier, { kind: "BANK_DEPOSIT", amount: 100, reason: "deposit" })).rejects.toThrow(/Open the drawer/);
    await expect(closeShift(cashier, { countedCash: 0 })).rejects.toThrow(/not open/);
    await openShift(cashier, 500_000);
    await expect(openShift(owner, 100_000)).rejects.toThrow(/already open/);
    await expect(openShift(cashier, -1)).rejects.toThrow(/zero or more/).catch(() => undefined);
    const d = await getDrawer(cashier);
    expect(d.current).toMatchObject({ expected: 500_000 });
    expect(d.history).toEqual([]); // history is for owners and managers
  });

  it("expects the float plus cash sales, less cash refunds, plus and minus what was moved", async () => {
    const a = await cashSale(2);
    const b = await cashSale(1);
    await refundInvoice(owner, b.inv.id, "wrong order");
    await addMovement(cashier, { kind: "BANK_DEPOSIT", amount: 200_000, reason: "Evening deposit" });
    await addMovement(cashier, { kind: "OWNER_ADDS", amount: 50_000, reason: "Owner added change" });
    const d = await getDrawer(cashier);
    expect(d.current!.cashSales).toBe(a.total + b.total);
    expect(d.current!.cashRefunds).toBe(b.total);
    expect(d.current!.expected).toBe(500_000 + a.total + b.total - b.total - 200_000 + 50_000);
    expect(d.current!.movements).toHaveLength(2);
  });

  it("checks what was put in and taken out", async () => {
    await expect(addMovement(cashier, { kind: "OTHER_OUT", amount: 99_999_999, reason: "too much" })).rejects.toThrow(/more cash than the drawer/);
    await expect(addMovement(cashier, { kind: "OTHER_OUT", amount: 100, reason: "x" })).rejects.toThrow(/what it was for/);
    await expect(addMovement(cashier, { kind: "NOPE", amount: 100, reason: "reason here" })).rejects.toThrow(/what the cash was for/);
    await expect(addMovement(cashier, { kind: "OTHER_OUT", amount: 0, reason: "reason here" })).rejects.toThrow(/above zero/);
    await expect(addMovement(waiter, { kind: "OTHER_OUT", amount: 100, reason: "reason here" })).rejects.toThrow(/permission/);
  });

  it("closes with the count, needs a reason for a difference, and shows it to the owner", async () => {
    const d = await getDrawer(cashier);
    const expected = d.current!.expected;
    await expect(closeShift(cashier, { countedCash: expected - 15_000 })).rejects.toThrow(/short by Rs 150.*Say why/);
    const r = await closeShift(cashier, { countedCash: expected - 15_000, note: "gave wrong change" });
    expect(r).toMatchObject({ expected, difference: -15_000 });
    expect((await getDrawer(cashier)).current).toBeNull();
    const h = (await getDrawer(owner)).history;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ difference: -15_000, note: "gave wrong change", openKey: null });
    expect((await getDrawer(owner)).lastCounted).toBe(expected - 15_000);
    await expect(closeShift(cashier, { countedCash: 0 })).rejects.toThrow(/not open/);
    // A new shift can be opened after the old one is closed.
    await openShift(owner, 100_000);
    await closeShift(owner, { countedCash: 100_000 });
  });

  it("posts the cash moves and the difference to the books, and the books balance", async () => {
    expect(await syncPostings(businessId)).toBeGreaterThan(0);
    const entries = await db.journalEntry.findMany({ where: { businessId, voucher: "DRAWER" }, include: { lines: { include: { account: true } } } });
    const text = entries.map((e) => `${e.narration}|${e.lines.map((l) => `${l.account.key}:${l.debit}/${l.credit}`).join(",")}`).join("\n");
    expect(text).toContain("Taken to the bank: Evening deposit|BANK:200000/0,CASH:0/200000");
    expect(text).toContain("Put in by the owner: Owner added change|CASH:50000/0,CAPITAL:0/50000");
    expect(text).toMatch(/short by 150\.00. gave wrong change\|CASH_DIFF:15000\/0,CASH:0\/15000/);
    const tb = await getTrialBalance(owner, today);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    const cash = await db.account.findFirstOrThrow({ where: { businessId, key: "CASH" } });
    expect((await getLedger(owner, cash.id, today, today)).rows.length).toBeGreaterThan(3);
  });
});
