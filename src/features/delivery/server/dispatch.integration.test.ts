import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { makeStockItem } from "@/features/stock/server/test-support";
import type { TenantContext } from "@/server/auth";
import { addItem, assignRider, checkout, createOrder, previewBill, setDeliveryStatus } from "@/features/orders/server/service";
import { setBranchLocation } from "@/features/branches/server/service";
import { createAddOn, createGroup, setAddOnStock, setGroupItems } from "@/features/menu/server/addons";
import { setPushSender } from "@/features/notifications/server/push";
import { runScheduledAlerts, secretMatches } from "@/features/notifications/server/scheduled";
import { GET as cronGet } from "@/app/api/cron/alerts/route";
import { createBand, getTracking, riderUpdateAsUser, setRoadFactor } from "./service";
import { getDispatchBoard, getMyAccount, getRiderAccounts, recordHandIn, recordPayout, setRiderPay } from "./dispatch";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  owner: TenantContext;
  manager: TenantContext;
  cashier: TenantContext;
  waiter: TenantContext;
  kitchen: TenantContext;
  rider: TenantContext;
  branchA: string;
  tea: string;
  momo: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, manager, cashier, waiter, kitchen, rider] = await Promise.all(["owner", "mgr", "cash", "wait", "kit", "rider"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const a = await db.branch.create({ data: { businessId: biz.id, name: "Branch A" } });
  for (const [u, role] of [[manager, "MANAGER"], [cashier, "CASHIER"], [waiter, "WAITER"], [kitchen, "KITCHEN"], [rider, "RIDER"]] as const) {
    await db.membership.create({ data: { userId: u.id, businessId: biz.id, role, allBranches: false, branches: { create: { branchId: a.id, businessId: biz.id } } } });
  }
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000 } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 20_000 } });
  const ctx = (userId: string, role: TenantContext["role"]): TenantContext => ({ userId, businessId: biz.id, branchId: a.id, branchIds: [a.id], role });
  return {
    owner: ctx(owner.id, "OWNER"),
    manager: ctx(manager.id, "MANAGER"),
    cashier: ctx(cashier.id, "CASHIER"),
    waiter: ctx(waiter.id, "WAITER"),
    kitchen: ctx(kitchen.id, "KITCHEN"),
    rider: ctx(rider.id, "RIDER"),
    branchA: a.id,
    tea: tea.id,
    momo: momo.id,
  };
}

// a nearby location by default, so every order gets a distance (and the first band) once the branch has bands
const delivery = (extra: Record<string, unknown> = {}) => ({ name: "Sita", phone: "9841234567", address: "House 4, Lakeside", location: "27.7200, 85.3150", ...extra });
const newDelivery = (ctx: TenantContext, extra: Record<string, unknown> = {}) =>
  createOrder(ctx, { type: "DELIVERY", idempotencyKey: `k-${uid()}-${stamp}`, delivery: delivery(extra) });
const withTea = async (ctx: TenantContext, extra: Record<string, unknown> = {}, qty = 1) => {
  const o = await newDelivery(ctx, extra);
  const tea = await db.menuItem.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "Tea" } });
  await addItem(ctx, o.id, { menuItemId: tea.id, quantity: qty });
  return o;
};
const payFull = async (ctx: TenantContext, orderId: string) => {
  const t = await previewBill(ctx, orderId, { kind: "none" });
  return checkout(ctx, orderId, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
};
/** Assign, pick up and deliver through the rider's own account. */
const deliverBy = async (w: World, orderId: string) => {
  await assignRider(w.waiter, orderId, w.rider.userId);
  await riderUpdateAsUser(w.rider, orderId, "PICKED_UP");
  await riderUpdateAsUser(w.rider, orderId, "DELIVERED");
};

let w: World;
let other: World;
const sent: { endpoint: string; body: { title: string; body: string } }[] = [];

beforeAll(async () => {
  w = await makeWorld("itest-disp-a");
  other = await makeWorld("itest-disp-b");
});

afterEach(() => {
  setPushSender(null);
  vi.unstubAllGlobals();
  delete process.env.ROUTING_URL;
  delete process.env.CRON_SECRET;
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.pushLog.deleteMany({ where: { businessId: id } });
    await db.pushSubscription.deleteMany({ where: { businessId: id } });
    await db.riderEntry.deleteMany({ where: { businessId: id } });
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

describe("automatic distance", () => {
  it("only managers set a branch location, and it must be readable", async () => {
    await expect(setBranchLocation(w.waiter, w.branchA, "27.7154, 85.3123")).rejects.toThrow(/owner/i);
    await expect(setBranchLocation(w.owner, w.branchA, "Thamel")).rejects.toThrow(/could not read/i);
    await expect(setBranchLocation(other.owner, w.branchA, "27.7, 85.3")).rejects.toThrow(/not found/i);
    await setBranchLocation(w.owner, w.branchA, "https://www.google.com/maps/place/Thamel/@27.7154,85.3123,17z");
    expect(await db.branch.findUniqueOrThrow({ where: { id: w.branchA } })).toMatchObject({ latitude: 27.7154, longitude: 85.3123 });
  });

  it("works out the distance and fee from a pasted location, and keeps the point for the map", async () => {
    await createBand(w.owner, { upToKm: 3, fee: 10_000 });
    await createBand(w.owner, { upToKm: 8, fee: 25_000 });
    // about 4.3 km in a straight line, 5.6 km with the default road factor of 130%
    const far = await newDelivery(w.waiter, { location: "27.6766, 85.3142" });
    expect(far.deliveryFee).toBe(25_000);
    expect(far.deliveryDistanceMeters).toBeGreaterThan(5_400);
    expect(far.deliveryDistanceMeters).toBeLessThan(5_800);
    expect(far).toMatchObject({ destLat: 27.6766, destLng: 85.3142 });

    // a close address lands in the first band
    expect((await newDelivery(w.waiter, { location: "27.7200, 85.3150" })).deliveryFee).toBe(10_000);
    // a far one is refused with the range
    await expect(newDelivery(w.waiter, { location: "27.9, 85.5" })).rejects.toThrow(/outside the delivery range \(up to 8 km\)/);
    // a location we cannot read is refused rather than guessed
    await expect(newDelivery(w.waiter, { location: "near the big temple" })).rejects.toThrow(/could not read/i);
  });

  it("uses a bigger or smaller road factor, within limits", async () => {
    await expect(setRoadFactor(w.waiter, 150)).rejects.toThrow(/permission/i);
    await expect(setRoadFactor(w.owner, 90)).rejects.toThrow(/between 100 and 300/);
    await expect(setRoadFactor(w.owner, 130.5)).rejects.toThrow(/between 100 and 300/);
    await setRoadFactor(w.owner, 100);
    const straight = await newDelivery(w.waiter, { location: "27.6766, 85.3142" });
    expect(straight.deliveryDistanceMeters).toBeLessThan(4_600);
    await setRoadFactor(w.owner, 130);
  });

  it("uses the real road distance from a routing server when one is set up, and falls back if it fails", async () => {
    process.env.ROUTING_URL = "https://routing.example.test";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 2_100 }] })));
    expect((await newDelivery(w.waiter, { location: "27.6766, 85.3142" })).deliveryDistanceMeters).toBe(2_100);
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect((await newDelivery(w.waiter, { location: "27.6766, 85.3142" })).deliveryDistanceMeters).toBeGreaterThan(5_000);
  });

  it("falls back to the typed distance when the branch has no location, and still keeps the point", async () => {
    await setBranchLocation(w.owner, w.branchA, "");
    try {
      const o = await newDelivery(w.waiter, { location: "27.6766, 85.3142", distanceKm: 2.5 });
      expect(o).toMatchObject({ deliveryDistanceMeters: 2_500, deliveryFee: 10_000, destLat: 27.6766 });
      await expect(newDelivery(w.waiter, { location: "27.6766, 85.3142" })).rejects.toThrow(/distance/i);
    } finally {
      await setBranchLocation(w.owner, w.branchA, "27.7154, 85.3123");
    }
  });

  it("gives the customer's tracking page the points to draw, and nothing personal", async () => {
    const o = await withTea(w.waiter, { location: "27.6766, 85.3142" });
    await assignRider(w.waiter, o.id, w.rider.userId);
    await riderUpdateAsUser(w.rider, o.id, "PICKED_UP");
    const t = (await getTracking(o.trackingToken!))!;
    expect(t.map.branch).toEqual({ lat: 27.7154, lng: 85.3123 });
    expect(t.map.destination).toEqual({ lat: 27.6766, lng: 85.3142 });
    expect(t.map.rider).toBeNull(); // nobody has shared a position yet
    expect(JSON.stringify(t)).not.toMatch(/9841234567|Lakeside/);
  });
});

describe("dispatch board", () => {
  it("sorts deliveries into columns, shows rider workload, and is for staff who take orders", async () => {
    await expect(getDispatchBoard(w.kitchen)).rejects.toThrow(/permission/i);
    await expect(getDispatchBoard(w.rider)).rejects.toThrow(/permission/i);

    const needs = await withTea(w.waiter, { location: "27.7200, 85.3150" });
    const waiting = await withTea(w.waiter, { location: "27.7200, 85.3150" });
    await assignRider(w.waiter, waiting.id, w.rider.userId);
    const out = await withTea(w.waiter, { location: "27.7200, 85.3150" });
    await assignRider(w.waiter, out.id, w.rider.userId);
    await riderUpdateAsUser(w.rider, out.id, "PICKED_UP");
    const done = await withTea(w.waiter, { location: "27.7200, 85.3150" });
    await deliverBy(w, done.id);

    const board = await getDispatchBoard(w.waiter);
    expect(board.unassigned.map((c) => c.id)).toContain(needs.id);
    expect(board.waiting.map((c) => c.id)).toContain(waiting.id);
    expect(board.out.map((c) => c.id)).toContain(out.id);
    expect(board.finished.map((c) => c.id)).toContain(done.id);
    expect(board.unassigned.map((c) => c.id)).not.toContain(waiting.id);
    const r = board.riders.find((x) => x.userId === w.rider.userId)!;
    const mine = [...board.waiting, ...board.out].filter((c) => c.riderUserId === w.rider.userId);
    expect(r.load).toBe(mine.length); // waiting + out; the finished one does not count
    expect(r.load).toBeGreaterThanOrEqual(2);
    expect(r.onTheRoad).toBe(board.out.filter((c) => c.riderUserId === w.rider.userId).length);

    // another business sees none of it
    const theirs = await getDispatchBoard(other.waiter);
    expect([...theirs.unassigned, ...theirs.waiting, ...theirs.out, ...theirs.finished]).toHaveLength(0);
  });
});

describe("rider cash and pay", () => {
  it("records the cash collected for an unpaid bill, and nothing for a paid one", async () => {
    await setRiderPay(w.owner, w.rider.userId, 5_000);
    const unpaid = await withTea(w.waiter, {}, 2);
    const unpaidTotal = (await previewBill(w.waiter, unpaid.id, { kind: "none" })).grandTotal;
    await deliverBy(w, unpaid.id);
    expect(await db.order.findUniqueOrThrow({ where: { id: unpaid.id } })).toMatchObject({ cashCollected: unpaidTotal, riderPay: 5_000 });

    const paid = await withTea(w.waiter);
    await payFull(w.owner, paid.id);
    await deliverBy(w, paid.id);
    expect(await db.order.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ cashCollected: 0, riderPay: 5_000 });

    const acc = await getMyAccount(w.rider);
    expect(acc.cashOwed).toBeGreaterThanOrEqual(unpaidTotal);
    expect(acc.earned).toBeGreaterThanOrEqual(10_000);
  });

  it("a failed delivery earns nothing and collects nothing; staff finishing it works the same way", async () => {
    const before = await getMyAccount(w.rider);
    const failed = await withTea(w.waiter);
    await assignRider(w.waiter, failed.id, w.rider.userId);
    await riderUpdateAsUser(w.rider, failed.id, "PICKED_UP");
    await riderUpdateAsUser(w.rider, failed.id, "FAILED");
    expect(await db.order.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ cashCollected: 0, riderPay: 0 });
    expect(await getMyAccount(w.rider)).toEqual(before);

    const byStaff = await withTea(w.waiter);
    await assignRider(w.waiter, byStaff.id, w.rider.userId);
    await setDeliveryStatus(w.waiter, byStaff.id, { status: "OUT_FOR_DELIVERY" });
    await setDeliveryStatus(w.waiter, byStaff.id, { status: "DELIVERED" });
    const row = await db.order.findUniqueOrThrow({ where: { id: byStaff.id } });
    expect(row.cashCollected).toBeGreaterThan(0);
    expect(row.riderPay).toBe(5_000);
    expect(row.deliveredAt).not.toBeNull();
  });

  it("a later change of rate or of the bill does not rewrite what was recorded", async () => {
    const o = await withTea(w.waiter);
    await deliverBy(w, o.id);
    const recorded = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    await setRiderPay(w.owner, w.rider.userId, 9_000);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).riderPay).toBe(recorded.riderPay);
    const next = await withTea(w.waiter);
    await deliverBy(w, next.id);
    expect((await db.order.findUniqueOrThrow({ where: { id: next.id } })).riderPay).toBe(9_000);
    await setRiderPay(w.owner, w.rider.userId, 5_000);
  });

  it("only the right people can settle, and a hand-in or pay-out cannot be more than is owed", async () => {
    const acc = (await getRiderAccounts(w.cashier)).find((a) => a.userId === w.rider.userId)!;
    expect(acc.cashOwed).toBeGreaterThan(0);
    expect(acc.payDue).toBeGreaterThan(0);

    for (const bad of [w.waiter, w.kitchen, w.rider]) {
      await expect(recordHandIn(bad, w.rider.userId, 100)).rejects.toThrow(/permission/i);
      await expect(getRiderAccounts(bad)).rejects.toThrow(/permission/i);
    }
    await expect(setRiderPay(w.cashier, w.rider.userId, 1_000)).rejects.toThrow(/permission/i); // pay rates are for managers
    await expect(setRiderPay(w.owner, w.rider.userId, -1)).rejects.toThrow(/pay/i);
    await expect(recordHandIn(other.cashier, w.rider.userId, 100)).rejects.toThrow(/not found/i);

    await expect(recordHandIn(w.cashier, w.rider.userId, acc.cashOwed + 1)).rejects.toThrow(/only holds/i);
    await expect(recordHandIn(w.cashier, w.rider.userId, 0)).rejects.toThrow(/amount/i);
    await expect(recordHandIn(w.cashier, w.rider.userId, 12.5)).rejects.toThrow(/amount/i);
    await recordHandIn(w.cashier, w.rider.userId, 3_000, "first handover");
    await expect(recordPayout(w.cashier, w.rider.userId, acc.payDue + 1)).rejects.toThrow(/only owed/i);
    await recordPayout(w.manager, w.rider.userId, 4_000);

    const after = (await getRiderAccounts(w.manager)).find((a) => a.userId === w.rider.userId)!;
    expect(after.cashOwed).toBe(acc.cashOwed - 3_000);
    expect(after.payDue).toBe(acc.payDue - 4_000);
    expect(after.entries.map((e) => e.kind)).toEqual(["PAYOUT", "CASH_HANDIN"]); // newest first
    expect(after.entries[1]!.note).toBe("first handover");

    // the rider sees the same balance on their own page, and nobody else's
    expect(await getMyAccount(w.rider)).toMatchObject({ cashOwed: after.cashOwed, payDue: after.payDue });
    await expect(getMyAccount(w.waiter)).rejects.toThrow(/permission/i);
  });

  it("two cashiers recording at once cannot take out more than the rider holds", async () => {
    const acc = (await getRiderAccounts(w.owner)).find((a) => a.userId === w.rider.userId)!;
    const half = Math.floor(acc.cashOwed / 2) + 1; // two of these are more than the balance
    const results = await Promise.allSettled([recordHandIn(w.cashier, w.rider.userId, half), recordHandIn(w.owner, w.rider.userId, half)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getMyAccount(w.rider)).cashOwed).toBe(acc.cashOwed - half);
  });
});

describe("alerts for low stock", () => {
  const fake = () => {
    sent.length = 0;
    setPushSender(async (s, payload) => {
      sent.push({ endpoint: s.endpoint, body: JSON.parse(payload) });
    });
  };
  const subscribe = (ctx: TenantContext) =>
    db.pushSubscription.create({
      data: { userId: ctx.userId, businessId: ctx.businessId, endpoint: `https://push.example.test/${ctx.userId}-${stamp}`, p256dh: "B".repeat(87), auth: "A".repeat(22) },
    });

  it("tells stock people when a sale pushes an item from fine to low, once, and not the waiter", async () => {
    await db.pushSubscription.deleteMany({ where: { businessId: w.owner.businessId } });
    await Promise.all([subscribe(w.owner), subscribe(w.kitchen), subscribe(w.waiter)]);
    const flour = await makeStockItem(w.owner.businessId, w.owner.branchId, { name: "Flour", unit: "g", quantity: 1_000, reorderLevel: 900 });
    const group = await createGroup(w.owner, { name: "Extras", required: false, multiple: true });
    const extra = await createAddOn(w.owner, group.id, { name: "Extra flour", price: 1_000 });
    await setGroupItems(w.owner, group.id, [w.momo]);
    await setAddOnStock(w.owner, extra.id, [{ stockItemId: flour.id, quantity: 200 }]);

    fake();
    const o = await createOrder(w.waiter, { type: "TAKEAWAY", idempotencyKey: `k-${uid()}-${stamp}` });
    await addItem(w.waiter, o.id, { menuItemId: w.momo, quantity: 1, addOnIds: [extra.id] });
    await payFull(w.owner, o.id);
    await new Promise((r) => setTimeout(r, 150));
    expect(sent.map((s) => s.body.title)).toEqual(["Stock is running low", "Stock is running low"]);
    expect(sent[0]!.body.body).toBe("Flour");
    expect(sent.some((s) => s.endpoint.includes(w.waiter.userId))).toBe(false);

    // already low: the next sale does not alert again
    fake();
    const o2 = await createOrder(w.waiter, { type: "TAKEAWAY", idempotencyKey: `k-${uid()}-${stamp}` });
    await addItem(w.waiter, o2.id, { menuItemId: w.momo, quantity: 1, addOnIds: [extra.id] });
    await payFull(w.owner, o2.id);
    await new Promise((r) => setTimeout(r, 150));
    expect(sent).toHaveLength(0);
    await db.stockItem.deleteMany({ where: { businessId: w.owner.businessId, name: "Flour" } });
  });
});

describe("scheduled alerts", () => {
  it("only answers with the right secret, and is off without one", async () => {
    expect(secretMatches("a".repeat(20), "a".repeat(20))).toBe(true);
    expect(secretMatches("a".repeat(20), "b".repeat(20))).toBe(false);
    expect(secretMatches(null, "a".repeat(20))).toBe(false);
    expect(secretMatches("short", "short")).toBe(false); // too short to be a real secret
    expect(secretMatches("x", undefined)).toBe(false);

    const call = (auth?: string) => cronGet(new NextRequest("http://localhost/api/cron/alerts", { headers: auth ? { authorization: auth } : {} }));
    expect((await call("Bearer whatever")).status).toBe(404); // not configured: it does not even admit to existing
    process.env.CRON_SECRET = "s".repeat(24);
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call(`Bearer ${"s".repeat(24)}`)).status).toBe(200);
  });

  it("pushes about bills left open and low stock once a day, however often it runs", async () => {
    await db.pushLog.deleteMany({ where: { businessId: w.owner.businessId } });
    await db.pushSubscription.deleteMany({ where: { businessId: w.owner.businessId } });
    await Promise.all([
      db.pushSubscription.create({ data: { userId: w.waiter.userId, businessId: w.owner.businessId, endpoint: `https://push.example.test/w2-${stamp}`, p256dh: "B".repeat(87), auth: "A".repeat(22) } }),
      db.pushSubscription.create({ data: { userId: w.kitchen.userId, businessId: w.owner.businessId, endpoint: `https://push.example.test/k2-${stamp}`, p256dh: "B".repeat(87), auth: "A".repeat(22) } }),
    ]);
    await makeStockItem(w.owner.businessId, w.owner.branchId, { name: "Salt", unit: "g", quantity: 5, reorderLevel: 50 });
    const old = await createOrder(w.waiter, { type: "TAKEAWAY", idempotencyKey: `k-${uid()}-${stamp}` });
    await db.order.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } });

    sent.length = 0;
    setPushSender(async (s, payload) => {
      sent.push({ endpoint: s.endpoint, body: JSON.parse(payload) });
    });
    const first = await runScheduledAlerts();
    expect(first.staleBillAlerts).toBeGreaterThanOrEqual(1);
    expect(first.lowStockAlerts).toBeGreaterThanOrEqual(1);
    const titles = sent.map((s) => s.body.title);
    expect(titles.some((t) => /still open from an earlier day/.test(t))).toBe(true);
    expect(titles.some((t) => /stock item.* low/.test(t))).toBe(true);
    // floor staff get the bills alert, stock people get the stock one
    expect(sent.filter((s) => /still open/.test(s.body.title)).every((s) => s.endpoint.includes("w2-"))).toBe(true);
    expect(sent.filter((s) => /stock item/.test(s.body.title)).every((s) => s.endpoint.includes("k2-"))).toBe(true);

    sent.length = 0;
    await runScheduledAlerts(); // again, same day
    expect(sent.filter((s) => s.endpoint.includes("w2-") || s.endpoint.includes("k2-"))).toHaveLength(0);
    await db.stockItem.deleteMany({ where: { businessId: w.owner.businessId, name: "Salt" } });
  });
});
