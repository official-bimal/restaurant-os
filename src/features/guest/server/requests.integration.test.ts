import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { staffRequests, tableAlerts } from "./service";

const stamp = Date.now();
let businessId: string;
let branchId: string;
let waiter: TenantContext;
let kitchen: TenantContext;
let t1: string;
let t2: string;
let farTable: string;
let session1: string;
let session2: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `rq-${stamp}@it.test`, name: "Rq", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-rq-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const other = await db.branch.create({ data: { businessId, name: "Other" } });
  branchId = branch.id;
  const area = await db.area.create({ data: { businessId, branchId, name: "Hall" } });
  const otherArea = await db.area.create({ data: { businessId, branchId: other.id, name: "Hall" } });
  t1 = (await db.diningTable.create({ data: { businessId, branchId, areaId: area.id, label: "T1", capacity: 4 } })).id;
  t2 = (await db.diningTable.create({ data: { businessId, branchId, areaId: area.id, label: "T2", capacity: 4 } })).id;
  farTable = (await db.diningTable.create({ data: { businessId, branchId: other.id, areaId: otherArea.id, label: "X1", capacity: 4 } })).id;
  session1 = (await db.tableSession.create({ data: { businessId, tableId: t1 } })).id;
  session2 = (await db.tableSession.create({ data: { businessId, tableId: t2 } })).id;
  const base = { userId: user.id, businessId, branchId, branchIds: [branchId, other.id] };
  waiter = { ...base, role: "WAITER" };
  kitchen = { ...base, role: "KITCHEN" };
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.orderItem.deleteMany({ where: { businessId } });
  await db.order.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

describe("what guests are asking for", () => {
  it("lists requests with the bill so far, the bill first and the longest wait first", async () => {
    const cat = await db.menuCategory.create({ data: { businessId, name: "Food" } });
    const momo = await db.menuItem.create({ data: { businessId, categoryId: cat.id, name: "Momo", price: 20_000 } });
    const order = await db.order.create({ data: { businessId, branchId, number: 1, type: "DINE_IN", tableId: t1, idempotencyKey: `rq-${stamp}-1` } });
    await db.orderItem.create({ data: { businessId, orderId: order.id, menuItemId: momo.id, name: "Momo", unitPrice: 20_000, quantity: 3 } });
    await db.orderItem.create({ data: { businessId, orderId: order.id, menuItemId: momo.id, name: "Momo", unitPrice: 20_000, quantity: 1, status: "CANCELLED" } });
    await db.serviceRequest.create({ data: { businessId, tableId: t2, sessionId: session2, kind: "WATER", createdAt: new Date(Date.now() - 5 * 60_000) } });
    await db.serviceRequest.create({ data: { businessId, tableId: t2, sessionId: session2, kind: "CALL_WAITER", createdAt: new Date(Date.now() - 3 * 60_000) } });
    await db.serviceRequest.create({ data: { businessId, tableId: t1, sessionId: session1, kind: "REQUEST_BILL", createdAt: new Date(Date.now() - 60_000) } });

    const list = await staffRequests(waiter);
    expect(list.map((r) => [r.tableLabel, r.kind])).toEqual([
      ["T1", "REQUEST_BILL"],
      ["T2", "CALL_WAITER"],
      ["T2", "WATER"],
    ]);
    expect(list[0]).toMatchObject({ orderId: order.id, bills: 1, total: 60_000 }); // the cancelled line is not on the bill
    expect(list[1]).toMatchObject({ orderId: null, total: 0 });
  });

  it("is empty for staff who do not handle the floor, and ignores tables of other branches", async () => {
    expect(await staffRequests(kitchen)).toEqual([]);
    const farSession = await db.tableSession.create({ data: { businessId, tableId: farTable } });
    await db.serviceRequest.create({ data: { businessId, tableId: farTable, sessionId: farSession.id, kind: "CALL_WAITER" } });
    expect((await staffRequests(waiter)).some((r) => r.tableLabel === "X1")).toBe(false);
    expect((await tableAlerts(waiter))[farTable]).toBeUndefined();
  });

  it("drops a request once it is done", async () => {
    const bill = (await staffRequests(waiter)).find((r) => r.kind === "REQUEST_BILL")!;
    await db.serviceRequest.update({ where: { id: bill.id }, data: { status: "DONE", doneAt: new Date() } });
    expect((await staffRequests(waiter)).some((r) => r.id === bill.id)).toBe(false);
  });
});
