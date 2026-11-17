import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { itemAt, makeStockItem } from "@/features/stock/server/test-support";
import type { TenantContext } from "@/server/auth";
import { addItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { getDayReport } from "@/features/reports/server/service";
import { listNotifications, markAllRead, markRead } from "@/features/notifications/server/service";
import { createGroup, createAddOn, setAddOnStock, setGroupItems } from "@/features/menu/server/addons";
import { addSchedule, createMenuSet, orderableItemIds, setActiveMenuSet, setMenuSetItems } from "@/features/menu/server/menu-sets";
import { activeZones, createZone, getRiderJob, getTracking, listZones, riderUpdate, setZoneActive, updateZone } from "./service";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  owner: TenantContext;
  ownerAtB: TenantContext;
  waiter: TenantContext;
  branchB: string;
  momo: string;
  tea: string;
}

async function makeWorld(name: string): Promise<World> {
  const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const biz = await db.business.create({
    data: { name, memberships: { create: { userId: user.id, role: "OWNER" } }, serviceChargeBps: 1000, vatBps: 1300 },
  });
  businessIds.push(biz.id);
  const a = await db.branch.create({ data: { businessId: biz.id, name: "Branch A" } });
  const b = await db.branch.create({ data: { businessId: biz.id, name: "Branch B" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 20_000 } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000 } });
  const both = [a.id, b.id];
  const base = { userId: user.id, businessId: biz.id, branchIds: both };
  return {
    owner: { ...base, branchId: a.id, role: "OWNER" },
    ownerAtB: { ...base, branchId: b.id, role: "OWNER" },
    waiter: { ...base, branchId: a.id, role: "WAITER" },
    branchB: b.id,
    momo: momo.id,
    tea: tea.id,
  };
}

const delivery = (extra: Record<string, unknown> = {}) => ({ name: "Sita Rai", phone: "9841234567", address: "House 4, Lakeside", ...extra });
const newDelivery = (ctx: TenantContext, zoneId?: string) =>
  createOrder(ctx, { type: "DELIVERY", idempotencyKey: `k-${uid()}-${stamp}`, delivery: delivery({ zoneId }) });
const pay = async (ctx: TenantContext, orderId: string) => {
  const t = await previewBill(ctx, orderId, { kind: "none" });
  return checkout(ctx, orderId, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
};

let w: World;
let other: World;

beforeAll(async () => {
  w = await makeWorld("itest-deliv-a");
  other = await makeWorld("itest-deliv-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.branch.updateMany({ where: { businessId: id }, data: { activeMenuSetId: null } });
    await db.notificationRead.deleteMany({ where: { businessId: id } });
    await db.stockMovement.deleteMany({ where: { businessId: id } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("delivery zones and fees", () => {
  let lakeside: string;

  it("is free while the branch has no zones", async () => {
    const order = await newDelivery(w.waiter);
    expect(order.deliveryFee).toBe(0);
    await addItem(w.waiter, order.id, { menuItemId: w.tea, quantity: 1 });
    expect((await previewBill(w.waiter, order.id, { kind: "none" })).deliveryFee).toBe(0);
  });

  it("only managers manage zones, names are unique per branch, and zones belong to one branch", async () => {
    await expect(createZone(w.waiter, { name: "Lakeside", fee: 10_000 })).rejects.toThrow(/permission/i);
    lakeside = (await createZone(w.owner, { name: "Lakeside", fee: 15_000 })).id;
    await expect(createZone(w.owner, { name: "Lakeside", fee: 1 })).rejects.toThrow(/already exists/);
    await expect(createZone(w.owner, { name: "Far", fee: -5 })).rejects.toThrow(/fee/i);
    // the same name is fine in the other branch, which does not see ours
    await expect(createZone(w.ownerAtB, { name: "Lakeside", fee: 5_000 })).resolves.toBeTruthy();
    expect((await listZones(w.owner)).map((z) => z.name)).toEqual(["Lakeside"]);
    expect(await activeZones(other.owner)).toEqual([]);
    await expect(updateZone(other.owner, lakeside, { name: "Hijack", fee: 0 })).rejects.toThrow(/not found/i);
  });

  it("requires a zone once the branch has them, and rejects another branch's zone", async () => {
    await expect(newDelivery(w.waiter)).rejects.toThrow(/area/i);
    const zoneB = (await activeZones(w.ownerAtB))[0]!.id;
    await expect(newDelivery(w.waiter, zoneB)).rejects.toThrow(/area/i);
  });

  it("adds the fee after tax, with no service charge or VAT on it, and keeps it on the invoice and report", async () => {
    const order = await newDelivery(w.waiter, lakeside);
    expect(order).toMatchObject({ deliveryFee: 15_000, deliveryZoneName: "Lakeside" });
    await addItem(w.waiter, order.id, { menuItemId: w.momo, quantity: 1 }); // Rs 200 food

    const t = await previewBill(w.waiter, order.id, { kind: "none" });
    // 20,000 + 10% service 2,000 + 13% VAT on 22,000 = 2,860 -> 24,860, then + 15,000 fee = 39,860 -> rounded to the rupee
    expect(t.serviceCharge).toBe(2_000);
    expect(t.vat).toBe(2_860);
    expect(t.deliveryFee).toBe(15_000);
    expect(t.grandTotal).toBe(39_900);

    const invoice = await pay(w.owner, order.id);
    expect(invoice.deliveryFee).toBe(15_000);
    const report = (await getDayReport(w.owner)).report;
    expect(report.sales.deliveryFee).toBeGreaterThanOrEqual(15_000);
  });

  it("a changed fee only affects new orders, and a switched-off zone is no longer offered", async () => {
    const before = await newDelivery(w.waiter, lakeside);
    await updateZone(w.owner, lakeside, { name: "Lakeside", fee: 20_000 });
    expect((await db.order.findUniqueOrThrow({ where: { id: before.id } })).deliveryFee).toBe(15_000);
    expect((await newDelivery(w.waiter, lakeside)).deliveryFee).toBe(20_000);

    await setZoneActive(w.owner, lakeside, false);
    expect(await activeZones(w.owner)).toEqual([]);
    // with every zone off, delivery is free again
    expect((await newDelivery(w.waiter)).deliveryFee).toBe(0);
  });
});

describe("customer tracking and rider pages", () => {
  it("the tracking page shows progress without the phone, address or prices", async () => {
    const order = await newDelivery(w.waiter);
    await addItem(w.waiter, order.id, { menuItemId: w.tea, quantity: 2 });
    const t = (await getTracking(order.trackingToken!))!;
    expect(t.status).toBe("PREPARING");
    expect(t.items).toEqual([{ name: "Tea", quantity: 2 }]);
    expect(JSON.stringify(t)).not.toMatch(/9841234567|Lakeside|House 4/);
    expect(await getTracking("x".repeat(30))).toBeNull();
    expect(await getTracking("short")).toBeNull();
    // the rider's token does not open the customer's page, and vice versa
    expect(await getTracking(order.riderToken!)).toBeNull();
    expect(await getRiderJob(order.trackingToken!)).toBeNull();
  });

  it("the rider sees the address, phone and cash to collect, and can only move forward", async () => {
    const order = await newDelivery(w.waiter);
    await addItem(w.waiter, order.id, { menuItemId: w.tea, quantity: 1 });
    const job = (await getRiderJob(order.riderToken!))!;
    expect(job).toMatchObject({ phone: "9841234567", address: "House 4, Lakeside", paid: false });
    expect(job.collect).toBeGreaterThan(8_000);

    await expect(riderUpdate(order.riderToken!, "DELIVERED")).rejects.toThrow(/not available/i);
    await riderUpdate(order.riderToken!, "PICKED_UP");
    expect((await getTracking(order.trackingToken!))!.status).toBe("OUT_FOR_DELIVERY");
    await expect(riderUpdate(order.riderToken!, "PICKED_UP")).rejects.toThrow(/not available/i);
    await riderUpdate(order.riderToken!, "DELIVERED");
    expect((await getTracking(order.trackingToken!))!.status).toBe("DELIVERED");
    await expect(riderUpdate(order.riderToken!, "FAILED")).rejects.toThrow(/not available/i);
    // the action was recorded without a staff user
    const audit = await db.auditEvent.findFirst({ where: { entityId: order.id, action: "order.deliveryByRider" } });
    expect(audit?.userId).toBeNull();
  });

  it("tells the rider not to collect cash on a bill that is already paid, and refuses a bad link", async () => {
    const order = await newDelivery(w.waiter);
    await addItem(w.waiter, order.id, { menuItemId: w.tea, quantity: 1 });
    await pay(w.owner, order.id);
    expect(await getRiderJob(order.riderToken!)).toMatchObject({ paid: true, collect: 0 });
    await expect(riderUpdate("nope", "PICKED_UP")).rejects.toThrow(/not valid/i);
    await expect(riderUpdate("a".repeat(30), "PICKED_UP")).rejects.toThrow(/not valid/i);
  });

  it("a cancelled order closes both pages", async () => {
    const order = await newDelivery(w.waiter);
    await db.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    expect((await getTracking(order.trackingToken!))!.status).toBe("CANCELLED");
    await expect(riderUpdate(order.riderToken!, "PICKED_UP")).rejects.toThrow(/cancelled/i);
  });
});

describe("add-ons that use stock", () => {
  it("takes the add-on's stock off when the bill is paid, once per dish ordered", async () => {
    const egg = await makeStockItem(w.owner.businessId, w.owner.branchId, { name: "Egg", unit: "piece", quantity: 50, costMilli: 10_000 });
    const group = await createGroup(w.owner, { name: "Extras", required: false, multiple: true });
    const extraEgg = await createAddOn(w.owner, group.id, { name: "Extra egg", price: 2_000 });
    await setGroupItems(w.owner, group.id, [w.momo]);

    await expect(setAddOnStock(w.waiter, extraEgg.id, [{ stockItemId: egg.id, quantity: 1 }])).rejects.toThrow(/permission/i);
    await expect(setAddOnStock(w.owner, extraEgg.id, [{ stockItemId: egg.id, quantity: 0 }])).rejects.toThrow(/whole number/i);
    await expect(setAddOnStock(other.owner, extraEgg.id, [{ stockItemId: egg.id, quantity: 1 }])).rejects.toThrow(/not found/i);
    await setAddOnStock(w.owner, extraEgg.id, [{ stockItemId: egg.id, quantity: 2 }]);

    const order = await createOrder(w.waiter, { type: "TAKEAWAY", idempotencyKey: `k-${uid()}-${stamp}` });
    await addItem(w.waiter, order.id, { menuItemId: w.momo, quantity: 3, addOnIds: [extraEgg.id] });
    await addItem(w.waiter, order.id, { menuItemId: w.momo, quantity: 1 }); // no egg on this one
    const invoice = await pay(w.owner, order.id);

    // 3 dishes x 2 eggs each; the plain one uses none
    expect((await itemAt(egg.id, w.owner.branchId)).quantity).toBe(44);
    const moves = await db.stockMovement.findMany({ where: { invoiceId: invoice.id, stockItemId: egg.id } });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: "SALE", quantity: -6, unitCostMilli: 10_000 });
  });
});

describe("menu sets per branch", () => {
  it("the hand-picked set and the schedule belong to one branch", async () => {
    const lunch = await createMenuSet(w.owner, "Lunch");
    await setMenuSetItems(w.owner, lunch.id, [w.momo]);

    await setActiveMenuSet(w.owner, lunch.id); // branch A only
    expect([...(await orderableItemIds(db, w.owner.businessId, w.owner.branchId))!]).toEqual([w.momo]);
    expect(await orderableItemIds(db, w.owner.businessId, w.branchB)).toBeNull();

    // a schedule in branch B does not affect branch A, and is refused when it overlaps within B
    await setActiveMenuSet(w.owner, null);
    for (let d = 0; d < 7; d++) await addSchedule(w.ownerAtB, { menuSetId: lunch.id, dayOfWeek: d, start: "00:00", end: "23:59" });
    expect(await orderableItemIds(db, w.owner.businessId, w.owner.branchId)).toBeNull();
    expect([...(await orderableItemIds(db, w.owner.businessId, w.branchB))!]).toEqual([w.momo]);
    await expect(addSchedule(w.ownerAtB, { menuSetId: lunch.id, dayOfWeek: 2, start: "10:00", end: "11:00" })).rejects.toThrow(/overlaps/);
    // but the same hours are free in branch A
    await expect(addSchedule(w.owner, { menuSetId: lunch.id, dayOfWeek: 2, start: "10:00", end: "11:00" })).resolves.toBeTruthy();

    // ordering follows the branch the order is in
    const inA = await createOrder(w.waiter, { type: "TAKEAWAY", idempotencyKey: `k-${uid()}-${stamp}` });
    await expect(addItem(w.waiter, inA.id, { menuItemId: w.tea, quantity: 1 })).resolves.toBeTruthy();
    const inB = await createOrder(w.ownerAtB, { type: "TAKEAWAY", idempotencyKey: `k-${uid()}-${stamp}` });
    await expect(addItem(w.ownerAtB, inB.id, { menuItemId: w.tea, quantity: 1 })).rejects.toThrow(/not on the menu/i);
  });
});

describe("notification read state", () => {
  it("is per person, only for what they can see, and a new notification is unread again", async () => {
    await makeStockItem(w.owner.businessId, w.owner.branchId, { name: "Salt", unit: "g", quantity: 10, reorderLevel: 100 });
    const first = (await listNotifications(w.owner)).find((x) => x.title.includes("Salt"))!;
    expect(first.read).toBe(false);

    await markRead(w.owner, [first.id, "not-a-real-key"]);
    expect((await listNotifications(w.owner)).find((x) => x.id === first.id)!.read).toBe(true);
    // unread ones come first
    const list = await listNotifications(w.owner);
    const firstRead = list.findIndex((x) => x.read);
    expect(list.slice(firstRead).every((x) => x.read)).toBe(true);
    // the key that was not a real notification was not stored
    expect(await db.notificationRead.count({ where: { userId: w.owner.userId, key: "not-a-real-key" } })).toBe(0);

    // someone else in another business is unaffected, and cannot mark ours read
    await markRead(other.owner, [first.id]);
    expect(await db.notificationRead.count({ where: { userId: other.owner.userId } })).toBe(0);

    await markAllRead(w.owner);
    expect((await listNotifications(w.owner)).every((x) => x.read)).toBe(true);
    // when the thing is dealt with, it disappears
    await db.stockItem.deleteMany({ where: { businessId: w.owner.businessId, name: "Salt" } });
    expect((await listNotifications(w.owner)).some((x) => x.title.includes("Salt"))).toBe(false);
  });
});
