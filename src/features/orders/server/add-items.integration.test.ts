import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createAddOn, createGroup, setGroupItems } from "@/features/menu/server/addons";
import { tableAlerts } from "@/features/guest/server/service";
import { addItem, addItems, createOrder } from "./service";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const key = () => `ai-${stamp}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  waiter: TenantContext;
  kitchen: TenantContext;
  otherBranch: TenantContext;
  businessId: string;
  branchId: string;
  tableId: string;
  momo: string;
  tea: string;
  gone: string;
  thali: string;
  large: string;
}

async function makeWorld(name: string): Promise<World> {
  const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const main = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const second = await db.branch.create({ data: { businessId: biz.id, name: "Second" } });
  const area = await db.area.create({ data: { businessId: biz.id, branchId: main.id, name: "Hall" } });
  const table = await db.diningTable.create({ data: { businessId: biz.id, branchId: main.id, areaId: area.id, label: "T1" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 25_000 } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000 } });
  const gone = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Sold out", price: 9_000, available: false } });
  const thali = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Thali", price: 40_000 } });
  const base = { businessId: biz.id, userId: user.id };
  const waiter: TenantContext = { ...base, role: "WAITER", branchId: main.id, branchIds: [main.id] };
  const owner: TenantContext = { ...base, role: "OWNER", branchId: main.id, branchIds: [main.id, second.id] };
  const g = await createGroup(owner, { name: "Size", required: true, multiple: false });
  const large = await createAddOn(owner, g.id, { name: "Large", price: 5_000 });
  await setGroupItems(owner, g.id, [thali.id]);
  return {
    waiter,
    kitchen: { ...waiter, role: "KITCHEN" },
    otherBranch: { ...base, role: "WAITER", branchId: second.id, branchIds: [second.id] },
    businessId: biz.id,
    branchId: main.id,
    tableId: table.id,
    momo: momo.id,
    tea: tea.id,
    gone: gone.id,
    thali: thali.id,
    large: large.id,
  };
}

let w: World;
beforeAll(async () => {
  w = await makeWorld("itest-additems");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.printJob.deleteMany({ where: { businessId: id } });
    await db.printSetting.deleteMany({ where: { businessId: id } });
    await db.guestSubmissionItem.deleteMany({ where: { businessId: id } });
    await db.guestSubmission.deleteMany({ where: { businessId: id } });
    await db.serviceRequest.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

const newOrder = (over: { tableId?: string } = {}) => createOrder(w.waiter, { type: over.tableId ? "DINE_IN" : "TAKEAWAY", tableId: over.tableId, idempotencyKey: key() });
const itemsOf = (orderId: string) => db.orderItem.findMany({ where: { orderId }, include: { addOns: true }, orderBy: { createdAt: "asc" } });

describe("adding several dishes at once", () => {
  it("adds every dish on the list, priced here, with its choices", async () => {
    const o = await newOrder();
    const added = await addItems(w.waiter, o.id, [
      { menuItemId: w.momo, quantity: 2 },
      { menuItemId: w.tea, quantity: 1 },
      { menuItemId: w.thali, quantity: 1, addOnIds: [w.large] },
    ]);
    expect(added).toHaveLength(3);
    const rows = await itemsOf(o.id);
    expect(rows.map((r) => [r.name, r.unitPrice, r.quantity])).toEqual([
      ["Momo", 25_000, 2],
      ["Tea", 8_000, 1],
      ["Thali", 45_000, 1],
    ]);
    expect(rows[2]!.addOns.map((a) => a.name)).toEqual(["Large"]);
  });

  it("all or nothing: one dish that cannot be added stops the whole list", async () => {
    const o = await newOrder();
    await expect(addItems(w.waiter, o.id, [{ menuItemId: w.momo, quantity: 1 }, { menuItemId: w.gone, quantity: 1 }])).rejects.toThrow(/not available/);
    expect(await itemsOf(o.id)).toHaveLength(0);
    // A required choice left out stops it too.
    await expect(addItems(w.waiter, o.id, [{ menuItemId: w.tea, quantity: 1 }, { menuItemId: w.thali, quantity: 1 }])).rejects.toThrow();
    expect(await itemsOf(o.id)).toHaveLength(0);
  });

  it("refuses an empty list, a silly quantity, and too long a list, without adding anything", async () => {
    const o = await newOrder();
    await expect(addItems(w.waiter, o.id, [])).rejects.toThrow(/at least one/);
    await expect(addItems(w.waiter, o.id, [{ menuItemId: w.momo, quantity: 0 }])).rejects.toThrow(/between 1 and 99/);
    await expect(addItems(w.waiter, o.id, [{ menuItemId: w.momo, quantity: 100 }])).rejects.toThrow(/between 1 and 99/);
    await expect(addItems(w.waiter, o.id, Array.from({ length: 41 }, () => ({ menuItemId: w.tea, quantity: 1 })))).rejects.toThrow(/lot of dishes/);
    expect(await itemsOf(o.id)).toHaveLength(0);
  });

  it("works only for an open order of the caller's own branch, and for people who may edit orders", async () => {
    const o = await newOrder();
    await expect(addItems(w.otherBranch, o.id, [{ menuItemId: w.tea, quantity: 1 }])).rejects.toThrow(/Order not found/);
    await expect(addItems(w.kitchen, o.id, [{ menuItemId: w.tea, quantity: 1 }])).rejects.toThrow(/permission/);
    await db.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    await expect(addItems(w.waiter, o.id, [{ menuItemId: w.tea, quantity: 1 }])).rejects.toThrow(/closed/);
    expect(await itemsOf(o.id)).toHaveLength(0);
  });

  it("the single-dish way still works the same", async () => {
    const o = await newOrder();
    await addItem(w.waiter, o.id, { menuItemId: w.momo, quantity: 3, note: "no onion" });
    const [row] = await itemsOf(o.id);
    expect(row).toMatchObject({ name: "Momo", quantity: 3, note: "no onion", unitPrice: 25_000 });
    await expect(addItem(w.waiter, o.id, { menuItemId: w.momo, quantity: 0 })).rejects.toThrow(/between 1 and 99/);
  });

  it("sends the kitchen ONE slip for the whole list", async () => {
    await db.printSetting.upsert({ where: { businessId: w.businessId }, create: { businessId: w.businessId, autoKitchenPrint: true }, update: { autoKitchenPrint: true } });
    const o = await newOrder();
    await addItems(w.waiter, o.id, [{ menuItemId: w.momo, quantity: 1 }, { menuItemId: w.tea, quantity: 2 }, { menuItemId: w.momo, quantity: 1 }]);
    // The slip is queued in the background: give it a moment.
    for (let i = 0; i < 30; i++) {
      if ((await db.printJob.count({ where: { orderId: o.id } })) > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const jobs = await db.printJob.findMany({ where: { orderId: o.id } });
    expect(jobs).toHaveLength(1);
    // The slip lists the items still waiting to be printed when the printer collects it: all three, none printed yet.
    expect(await db.orderItem.count({ where: { orderId: o.id, printedAt: null } })).toBe(3);
  });
});

describe("what needs a waiter at each table", () => {
  it("is empty when nothing waits", async () => {
    expect(await tableAlerts(w.waiter)).toEqual({});
  });

  it("shows a guest's order waiting, and the most urgent call when there are several", async () => {
    const session = await db.tableSession.create({ data: { businessId: w.businessId, tableId: w.tableId } });
    await db.guestSubmission.create({ data: { businessId: w.businessId, tableId: w.tableId, sessionId: session.id, idempotencyKey: key() } });
    expect(await tableAlerts(w.waiter)).toEqual({ [w.tableId]: "Guest order waiting" });
    await db.serviceRequest.create({ data: { businessId: w.businessId, tableId: w.tableId, sessionId: session.id, kind: "WATER" } });
    expect((await tableAlerts(w.waiter))[w.tableId]).toBe("Guest order waiting"); // a guest order outranks water
    await db.serviceRequest.create({ data: { businessId: w.businessId, tableId: w.tableId, sessionId: session.id, kind: "CALL_WAITER" } });
    expect((await tableAlerts(w.waiter))[w.tableId]).toBe("Calling the waiter");
    await db.serviceRequest.create({ data: { businessId: w.businessId, tableId: w.tableId, sessionId: session.id, kind: "REQUEST_BILL" } });
    expect((await tableAlerts(w.waiter))[w.tableId]).toBe("Wants the bill");
  });

  it("only shows this branch's tables, and nothing to people who cannot handle orders", async () => {
    expect(await tableAlerts(w.otherBranch)).toEqual({});
    expect(await tableAlerts(w.kitchen)).toEqual({});
  });

  it("handled requests stop showing", async () => {
    await db.serviceRequest.updateMany({ where: { businessId: w.businessId }, data: { status: "DONE" } });
    await db.guestSubmission.updateMany({ where: { businessId: w.businessId }, data: { status: "REJECTED" } });
    expect(await tableAlerts(w.waiter)).toEqual({});
  });
});
