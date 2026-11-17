import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { localDate } from "@/lib/business-day";
import { addItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { cancelOrder, refundInvoice } from "@/features/orders/server/void";
import { closeDay, getDayReport, reopenDay } from "./service";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  owner: TenantContext;
  manager: TenantContext;
  cashier: TenantContext;
  waiter: TenantContext;
  areaId: string;
  momo: string;
  tea: string;
}

async function makeWorld(name: string): Promise<World> {
  const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main branch" } });
  businessIds.push(biz.id);
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 20_000 } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000 } });
  const base = { userId: user.id, businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, role: "OWNER" },
    manager: { ...base, role: "MANAGER" },
    cashier: { ...base, role: "CASHIER" },
    waiter: { ...base, role: "WAITER" },
    areaId: area.id,
    momo: momo.id,
    tea: tea.id,
  };
}

async function seat(w: World, items: { id: string; qty: number }[]) {
  const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.owner.branchId, areaId: w.areaId, label: `T${uid()}` } });
  const order = await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
  for (const i of items) await addItem(w.owner, order.id, { menuItemId: i.id, quantity: i.qty });
  return order;
}

async function pay(w: World, orderId: string, cashPart?: number) {
  const t = await previewBill(w.owner, orderId, { kind: "none" });
  const payments =
    cashPart === undefined
      ? [{ method: "CASH" as const, amount: t.grandTotal }]
      : [{ method: "CASH" as const, amount: cashPart }, { method: "QR" as const, amount: t.grandTotal - cashPart }];
  return checkout(w.owner, orderId, { discount: { kind: "none" }, payments });
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-rep-a");
  b = await makeWorld("itest-rep-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.dayClose.deleteMany({ where: { businessId: id } });
    await db.refundPayment.deleteMany({ where: { businessId: id } });
    await db.creditNote.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

const TZ = "Asia/Kathmandu";
const today = () => localDate(new Date(), TZ);

describe("the daily report", () => {
  it("adds up sales, methods, refunds, cancelled orders and top items for today", async () => {
    const i1 = await pay(a, (await seat(a, [{ id: a.momo, qty: 5 }])).id, 50_000); // cash + QR
    const i2 = await pay(a, (await seat(a, [{ id: a.momo, qty: 1 }, { id: a.tea, qty: 2 }])).id); // cash
    const i3 = await pay(a, (await seat(a, [{ id: a.tea, qty: 1 }])).id);
    await refundInvoice(a.manager, i3.id, "Guest unhappy");
    await cancelOrder(a.manager, (await seat(a, [{ id: a.tea, qty: 3 }])).id, "Walked out");

    const { report } = await getDayReport(a.manager);
    expect(report.sales.count).toBe(3);
    expect(report.sales.gross).toBe(i1.grandTotal + i2.grandTotal + i3.grandTotal);
    expect(report.refunds).toMatchObject({ count: 1, total: i3.grandTotal });
    expect(report.net).toBe(i1.grandTotal + i2.grandTotal);
    // payment methods add up to the invoices, and cash is net of the refund
    const methodSales = Object.values(report.byMethod).reduce((s, m) => s + m.sales, 0);
    expect(methodSales).toBe(report.sales.gross);
    expect(report.byMethod.QR.sales).toBe(i1.grandTotal - 50_000);
    expect(report.byMethod.CASH.refunds).toBe(i3.grandTotal);
    expect(report.expectedCash).toBe(50_000 + i2.grandTotal + i3.grandTotal - i3.grandTotal);
    expect(report.cancelled).toMatchObject({ count: 1 });
    expect(report.cancelled.orders[0]).toMatchObject({ reason: "Walked out", itemCount: 1 });
    expect(report.topItems[0]).toMatchObject({ name: "Momo", quantity: 6, revenue: 6 * 20_000 });
  });

  it("puts each invoice on the business's own calendar day, to the second", async () => {
    const x = await pay(a, (await seat(a, [{ id: a.momo, qty: 1 }])).id);
    const y = await pay(a, (await seat(a, [{ id: a.momo, qty: 2 }])).id);
    // Kathmandu local midnight between 10 and 11 Jan 2026 is 18:15:00 UTC.
    await db.invoice.update({ where: { id: x.id }, data: { createdAt: new Date("2026-01-10T18:14:59Z") } });
    await db.invoice.update({ where: { id: y.id }, data: { createdAt: new Date("2026-01-10T18:15:00Z") } });
    const tenth = await getDayReport(a.owner, "2026-01-10");
    const eleventh = await getDayReport(a.owner, "2026-01-11");
    expect(tenth.report.sales.gross).toBe(x.grandTotal);
    expect(eleventh.report.sales.gross).toBe(y.grandTotal);
  });

  it("does not rewrite an earlier day when its invoice is refunded later", async () => {
    const inv = await pay(a, (await seat(a, [{ id: a.tea, qty: 4 }])).id);
    await db.invoice.update({ where: { id: inv.id }, data: { createdAt: new Date("2026-01-05T06:00:00Z") } });
    const before = (await getDayReport(a.owner, "2026-01-05")).report;
    await refundInvoice(a.owner, inv.id, "Refunded a week later");
    const after = (await getDayReport(a.owner, "2026-01-05")).report;
    expect(after.sales.gross).toBe(before.sales.gross);
    expect(after.refunds.count).toBe(0);
    expect((await getDayReport(a.owner)).report.refundList.some((r) => r.invoiceNumber === inv.number)).toBe(true); // it lands on the day it happened
  });

  it("keeps businesses apart, rejects bad dates, and is limited to owner and manager", async () => {
    const mine = await getDayReport(a.owner);
    const theirs = await getDayReport(b.owner);
    expect(theirs.report.sales.count).toBe(0);
    expect(mine.report.sales.count).toBeGreaterThan(0);
    await expect(getDayReport(a.owner, "2026-02-30")).rejects.toThrow("valid date");
    await expect(getDayReport(a.owner, "today")).rejects.toThrow("valid date");
    await expect(getDayReport(a.cashier)).rejects.toThrow("permission");
    await expect(getDayReport(a.waiter)).rejects.toThrow("permission");
  });
});

describe("closing the day", () => {
  let c: World;
  beforeAll(async () => {
    c = await makeWorld("itest-rep-c");
  });

  it("is refused while a bill is open, for a future day, for a bad amount and for the wrong role", async () => {
    const open = await seat(c, [{ id: c.momo, qty: 1 }]);
    await expect(closeDay(c.manager, { date: today(), countedCash: 0 })).rejects.toThrow("still open");
    await cancelOrder(c.manager, open.id, "clearing the way");
    await expect(closeDay(c.manager, { date: "2999-01-01", countedCash: 0 })).rejects.toThrow("not happened");
    await expect(closeDay(c.manager, { date: today(), countedCash: -1 })).rejects.toThrow("cash you counted");
    await expect(closeDay(c.manager, { date: today(), countedCash: 10.5 })).rejects.toThrow("cash you counted");
    await expect(closeDay(c.manager, { date: "bad", countedCash: 0 })).rejects.toThrow("valid date");
    await expect(closeDay(c.cashier, { date: today(), countedCash: 0 })).rejects.toThrow("permission");
    await expect(closeDay(c.waiter, { date: today(), countedCash: 0 })).rejects.toThrow("permission");
  });

  it("records expected, counted and the difference, freezes the numbers, and cannot be closed twice", async () => {
    const i = await pay(c, (await seat(c, [{ id: c.momo, qty: 5 }])).id, 50_000); // 50,000 cash
    const row = await closeDay(c.manager, { date: today(), countedCash: 49_000, note: "  Short Rs 10  " });
    expect(row).toMatchObject({ expectedCash: 50_000, countedCash: 49_000, difference: -1_000, note: "Short Rs 10" });
    const snap = row.snapshot as { sales: { gross: number } };
    expect(snap.sales.gross).toBe(i.grandTotal);
    await expect(closeDay(c.owner, { date: today(), countedCash: 50_000 })).rejects.toThrow("already closed");
    const view = await getDayReport(c.manager);
    expect(view.dayClose?.difference).toBe(-1_000);
    expect(view.closedByName).toBe("itest-rep-c");
  });

  it("stops new payments and refunds from landing on a closed day", async () => {
    const o = await seat(c, [{ id: c.tea, qty: 1 }]); // opened after closing; allowed
    await expect(pay(c, o.id)).rejects.toThrow("already been closed");
    const earlier = (await db.invoice.findMany({ where: { businessId: c.owner.businessId } }))[0];
    await expect(refundInvoice(c.owner, earlier.id, "after close")).rejects.toThrow("already been closed");
    expect(await db.invoice.count({ where: { businessId: c.owner.businessId } })).toBe(1);
  });

  it("can be reopened only by the owner, and then payments work again", async () => {
    await expect(reopenDay(c.manager, today())).rejects.toThrow("Only the owner");
    await expect(reopenDay(c.owner, "2026-01-01")).rejects.toThrow("not closed");
    await reopenDay(c.owner, today());
    expect(await db.dayClose.count({ where: { businessId: c.owner.businessId } })).toBe(0);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { businessId: c.owner.businessId, action: "day.reopen" } });
    expect(JSON.stringify(audit.detail)).toContain("-1000"); // the old count is kept in the audit log
    const open = await db.order.findFirstOrThrow({ where: { businessId: c.owner.businessId, status: "OPEN" } });
    await expect(pay(c, open.id)).resolves.toBeTruthy();
  });

  it("closing a past day does not block today", async () => {
    await closeDay(c.owner, { date: "2026-01-10", countedCash: 0 });
    const o = await seat(c, [{ id: c.tea, qty: 1 }]);
    await expect(pay(c, o.id)).resolves.toBeTruthy();
    expect((await getDayReport(c.owner, "2026-01-10")).dayClose).not.toBeNull();
    await expect(closeDay(b.owner, { date: "2026-01-10", countedCash: 0 })).resolves.toBeTruthy(); // another business is unaffected
  });
});
