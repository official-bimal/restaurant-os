import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createOrder, addItem, previewBill, checkout } from "@/features/orders/server/service";
import { refundInvoice } from "@/features/orders/server/void";
import { getDashboardCharts } from "./charts";

const stamp = Date.now();
let n = 0;
let owner: TenantContext;
let waiter: TenantContext;
let businessId: string;
let momo: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `ch-${stamp}@it.test`, name: "Ch", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-ch-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId, name: "Food" } });
  momo = (await db.menuItem.create({ data: { businessId, categoryId: cat.id, name: "Momo", price: 20_000 } })).id;
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  waiter = { ...base, role: "WAITER" };
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
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

async function sale(method: "CASH" | "QR") {
  const o = await createOrder(owner, { type: "TAKEAWAY", idempotencyKey: `ch-${stamp}-${++n}` });
  await addItem(owner, o.id, { menuItemId: momo, quantity: 1 });
  const t = await previewBill(owner, o.id, { kind: "none" });
  const inv = await checkout(owner, o.id, { discount: { kind: "none" }, payments: [{ method, amount: t.grandTotal }] });
  return { inv, total: t.grandTotal };
}

describe("dashboard charts", () => {
  it("is empty before any sale", async () => {
    const c = await getDashboardCharts(owner);
    expect(c.byHour.every((v) => v === 0)).toBe(true);
    expect(c.methods).toEqual([]);
    expect(c.week.thisTotal).toBe(0);
    expect(c.week.changePercent).toBeNull();
    expect(c.week.thisWeek).toHaveLength(7);
    expect(c.week.lastWeek).toHaveLength(7);
  });

  it("adds sales into the hour, the methods and the week, and takes a refund off", async () => {
    const a = await sale("CASH");
    const b = await sale("QR");
    const c = await getDashboardCharts(owner);
    const total = a.total + b.total;
    expect(c.byHour.reduce((s, v) => s + v, 0)).toBe(total);
    expect(c.week.thisTotal).toBe(total);
    expect(c.week.thisWeek.at(-1)!.date).toBe(c.today);
    expect(c.methods.map((m) => m.label).sort()).toEqual(["Cash", "QR"]);
    expect(c.methodsTotal).toBe(total);
    expect(c.methods.reduce((s, m) => s + m.percent, 0)).toBeCloseTo(100, 0);

    await refundInvoice(owner, a.inv.id, "wrong order");
    const after = await getDashboardCharts(owner);
    expect(after.byHour.reduce((s, v) => s + v, 0)).toBe(b.total);
    expect(after.week.thisTotal).toBe(b.total);
  });

  it("is for people who may see reports", async () => {
    await expect(getDashboardCharts(waiter)).rejects.toThrow(/permission/);
  });
});
