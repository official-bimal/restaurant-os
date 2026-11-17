import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addItem, checkout, createOrder, kitchenTickets, listMenu, previewBill } from "@/features/orders/server/service";
import { createAddOn, createGroup, setGroupItems } from "@/features/menu/server/addons";
import { getBranchAddOnAdmin, setBranchAddOn, setBranchMenuItem, setCategoryHiddenHere } from "@/features/menu/server/branch-menu";
import { getBranchRollup } from "@/features/reports/server/service";
import { assignBatchRider, cancelBatch, createBatch, listBatches, removeFromBatch, startBatch } from "@/features/delivery/server/batches";
import { setDeliveryStatus } from "@/features/orders/server/service";

const stamp = Date.now();
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;
const businessIds: string[] = [];

interface World {
  ownerA: TenantContext; // owner at branch A, sees every branch
  ownerB: TenantContext;
  managerB: TenantContext;
  waiterA: TenantContext;
  waiterB: TenantContext;
  branchA: string;
  branchB: string;
  riderId: string;
  tea: string;
  cake: string;
  drinks: string;
  food: string;
  grill: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, mB, wA, wB, rider] = await Promise.all(["owner", "mgrB", "waitA", "waitB", "rider"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  // branch A has a location so runs can be planned from it
  const a = await db.branch.create({ data: { businessId: biz.id, name: "Branch A", latitude: 27.7172, longitude: 85.324 } });
  const b = await db.branch.create({ data: { businessId: biz.id, name: "Branch B" } });
  const join = (u: { id: string }, role: "MANAGER" | "WAITER" | "RIDER", branchId: string) =>
    db.membership.create({ data: { userId: u.id, businessId: biz.id, role, allBranches: false, branches: { create: { branchId, businessId: biz.id } } } });
  await Promise.all([join(mB, "MANAGER", b.id), join(wA, "WAITER", a.id), join(wB, "WAITER", b.id), join(rider, "RIDER", a.id)]);
  for (const br of [a, b]) {
    const area = await db.area.create({ data: { businessId: biz.id, branchId: br.id, name: "Main" } });
    await db.diningTable.create({ data: { businessId: biz.id, branchId: br.id, areaId: area.id, label: "T1" } });
  }
  const grill = await db.station.create({ data: { businessId: biz.id, name: "Grill" } });
  const drinks = await db.menuCategory.create({ data: { businessId: biz.id, name: "Drinks" } });
  const food = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: drinks.id, name: "Tea", price: 8_000 } });
  const cake = await db.menuItem.create({ data: { businessId: biz.id, categoryId: food.id, name: "Cake", price: 15_000 } });
  const ctx = (userId: string, role: TenantContext["role"], branchId: string, all = false): TenantContext => ({ userId, businessId: biz.id, branchId, branchIds: all ? [a.id, b.id] : [branchId], role });
  return {
    ownerA: ctx(owner.id, "OWNER", a.id, true),
    ownerB: ctx(owner.id, "OWNER", b.id, true),
    managerB: ctx(mB.id, "MANAGER", b.id),
    waiterA: ctx(wA.id, "WAITER", a.id),
    waiterB: ctx(wB.id, "WAITER", b.id),
    branchA: a.id,
    branchB: b.id,
    riderId: rider.id,
    tea: tea.id,
    cake: cake.id,
    drinks: drinks.id,
    food: food.id,
    grill: grill.id,
  };
}

let w: World;

beforeAll(async () => {
  w = await makeWorld("itest-branchops");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.deliveryPlace.deleteMany({ where: { businessId: id } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.deliveryBatch.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

const tableAt = (branchId: string) => db.diningTable.findFirstOrThrow({ where: { businessId: w.ownerA.businessId, branchId } });
/** A fresh table every time, so orders in one test never collide. */
async function freshTable(branchId: string) {
  const area = await db.area.findFirstOrThrow({ where: { businessId: w.ownerA.businessId, branchId } });
  return db.diningTable.create({ data: { businessId: w.ownerA.businessId, branchId, areaId: area.id, label: `X${uid()}` } });
}
async function order(ctx: TenantContext, items: { id: string; quantity?: number; addOnIds?: string[] }[]) {
  const t = await freshTable(ctx.branchId);
  const o = await createOrder(ctx, { type: "DINE_IN", tableId: t.id, idempotencyKey: `k-${uid()}-${stamp}` });
  for (const i of items) await addItem(ctx, o.id, { menuItemId: i.id, quantity: i.quantity ?? 1, addOnIds: i.addOnIds });
  return o;
}
async function pay(ctx: TenantContext, orderId: string) {
  const t = await previewBill(ctx, orderId, { kind: "none" });
  return checkout({ ...ctx, role: "OWNER" }, orderId, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
}

describe("branch categories, stations and add-on prices", () => {
  it("hides a whole category at one branch only", async () => {
    await expect(setCategoryHiddenHere(w.waiterB, w.food, true)).rejects.toThrow(/permission/i);
    await setCategoryHiddenHere(w.managerB, w.food, true);
    const namesAt = async (ctx: TenantContext) => (await listMenu(ctx)).flatMap((c) => c.items.map((i) => i.name));
    expect(await namesAt(w.waiterB)).toEqual(["Tea"]);
    expect(await namesAt(w.waiterA)).toEqual(expect.arrayContaining(["Tea", "Cake"]));
    // ordering a hidden dish is refused too, not just hidden from the list
    const t = await tableAt(w.branchB);
    const o = await createOrder(w.waiterB, { type: "DINE_IN", tableId: t.id, idempotencyKey: `k-${uid()}-${stamp}` });
    await expect(addItem(w.waiterB, o.id, { menuItemId: w.cake, quantity: 1 })).rejects.toThrow();
    await setCategoryHiddenHere(w.managerB, w.food, false);
    expect(await namesAt(w.waiterB)).toEqual(expect.arrayContaining(["Cake"]));
  });

  it("sends a dish to a different kitchen station at one branch", async () => {
    await setBranchMenuItem(w.managerB, w.cake, { price: null, available: true, stationId: w.grill });
    const o = await order(w.waiterB, [{ id: w.cake }]);
    const atB = (await kitchenTickets(w.waiterB)).find((r) => r.orderId === o.id)!;
    expect(atB.menuItem.station?.name).toBe("Grill");
    const oa = await order(w.waiterA, [{ id: w.cake }]);
    const atA = (await kitchenTickets(w.waiterA)).find((r) => r.orderId === oa.id)!;
    expect(atA.menuItem.station).toBeNull();
    await expect(setBranchMenuItem(w.managerB, w.cake, { price: null, available: true, stationId: "nope" })).rejects.toThrow(/Station not found/);
    // back to the shared setup removes the override
    await setBranchMenuItem(w.managerB, w.cake, { price: null, available: true, stationId: null });
    expect(await db.branchMenuItem.count({ where: { businessId: w.ownerA.businessId, menuItemId: w.cake } })).toBe(0);
  });

  it("charges a branch's own price for an add-on choice, and can switch it off there", async () => {
    const g = await createGroup(w.ownerA, { name: "Size", required: false, multiple: false });
    const large = await createAddOn(w.ownerA, g.id, { name: "Large", price: 5_000 });
    await setGroupItems(w.ownerA, g.id, [w.tea]);
    await setBranchAddOn(w.managerB, large.id, { price: 9_000, available: true });
    expect((await getBranchAddOnAdmin(w.managerB))[0]!.choices[0]).toMatchObject({ basePrice: 5_000, branchPrice: 9_000 });

    const priceOf = async (ctx: TenantContext) => {
      const o = await order(ctx, [{ id: w.tea, addOnIds: [large.id] }]);
      return (await db.orderItemAddOn.findFirstOrThrow({ where: { orderItem: { orderId: o.id } } })).price;
    };
    expect(await priceOf(w.waiterA)).toBe(5_000);
    expect(await priceOf(w.waiterB)).toBe(9_000);

    await setBranchAddOn(w.managerB, large.id, { price: null, available: false });
    await expect(order(w.waiterB, [{ id: w.tea, addOnIds: [large.id] }])).rejects.toThrow();
    await expect(setBranchAddOn(w.waiterB, large.id, { price: 1, available: true })).rejects.toThrow(/permission/i);
  });
});

describe("all-branches sales report", () => {
  it("adds the branches up exactly, and a branch-only person sees only their own", async () => {
    const before = await getBranchRollup(w.ownerA);
    const oA = await order(w.waiterA, [{ id: w.tea, quantity: 2 }]);
    const oB = await order(w.waiterB, [{ id: w.cake }]);
    const inA = await pay(w.waiterA, oA.id);
    const inB = await pay(w.waiterB, oB.id);
    const roll = await getBranchRollup(w.ownerA);
    const sumGross = roll.branches.reduce((s, b) => s + b.report.sales.gross, 0);
    expect(roll.combined.sales.gross).toBe(sumGross);
    expect(roll.combined.sales.count - before.combined.sales.count).toBe(2);
    expect(roll.combined.sales.gross - before.combined.sales.gross).toBe(inA.grandTotal + inB.grandTotal);
    expect(roll.branches.map((b) => b.name)).toEqual(["Branch A", "Branch B"]);
    const mine = await getBranchRollup(w.managerB);
    expect(mine.branches.map((b) => b.name)).toEqual(["Branch B"]);
    await expect(getBranchRollup(w.ownerA, { from: "2026-02-01", to: "2026-01-01" })).rejects.toThrow(/start date/);
  });
});

describe("delivery runs", () => {
  const delivery = (name: string, location: string, phone: string) => ({ name, phone, address: `${name}'s house`, location });
  async function newDelivery(name: string, location: string, phone: string) {
    return createOrder(w.waiterA, { type: "DELIVERY", idempotencyKey: `k-${uid()}-${stamp}`, delivery: delivery(name, location, phone) });
  }

  it("groups deliveries, plans a stop order starting from the branch, and refuses doubles", async () => {
    const far = await newDelivery("Far", "27.7600, 85.3600", "9841000001");
    const near = await newDelivery("Near", "27.7180, 85.3250", "9841000002");
    const mid = await newDelivery("Mid", "27.7300, 85.3300", "9841000003");
    await expect(createBatch(w.waiterA, { orderIds: [far.id] })).rejects.toThrow(/at least two/);
    const run = await createBatch(w.waiterA, { orderIds: [far.id, near.id, mid.id] });
    const [b] = (await listBatches(w.waiterA)).filter((x) => x.id === run.id);
    expect(b!.orders.map((o) => o.deliveryName)).toEqual(["Near", "Mid", "Far"]);
    expect(b!.orders.map((o) => o.batchStop)).toEqual([1, 2, 3]);
    expect(b!.plannedMeters).toBeGreaterThan(0);
    await expect(createBatch(w.waiterA, { orderIds: [far.id, near.id] })).rejects.toThrow(/already in a run/);
    // a run cannot be started without a rider
    await expect(startBatch(w.waiterA, run.id)).rejects.toThrow(/rider first/);
    await assignBatchRider(w.waiterA, run.id, w.riderId);
    await removeFromBatch(w.waiterA, far.id);
    expect((await listBatches(w.waiterA))[0]!.orders.map((o) => o.deliveryName)).toEqual(["Near", "Mid"]);
    await startBatch(w.waiterA, run.id);
    const out = await db.order.findMany({ where: { batchId: run.id } });
    expect(out.every((o) => o.deliveryStatus === "OUT_FOR_DELIVERY" && o.riderUserId === w.riderId)).toBe(true);
    await expect(cancelBatch(w.waiterA, run.id)).rejects.toThrow(/already left/);
    // finishing every delivery finishes the run
    for (const o of out) await setDeliveryStatus(w.waiterA, o.id, { status: "DELIVERED" });
    expect((await db.deliveryBatch.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("DONE");
  });

  it("breaks a run up when fewer than two deliveries are left, and keeps other branches out", async () => {
    const x = await newDelivery("X", "27.7190, 85.3260", "9841000004");
    const y = await newDelivery("Y", "27.7200, 85.3270", "9841000005");
    const run = await createBatch(w.waiterA, { orderIds: [x.id, y.id] });
    await expect(cancelBatch(w.waiterB, run.id)).rejects.toThrow(/not found/);
    await removeFromBatch(w.waiterA, x.id);
    expect(await db.deliveryBatch.count({ where: { id: run.id } })).toBe(0);
    expect((await db.order.findMany({ where: { id: { in: [x.id, y.id] } } })).every((o) => o.batchId === null)).toBe(true);
  });

  it("remembers a place for a phone number and reuses it only for the same address words", async () => {
    const first = await createOrder(w.waiterA, { type: "DELIVERY", idempotencyKey: `k-${uid()}-${stamp}`, delivery: { name: "Mina", phone: "9841000009", address: "Blue Gate, Lakeside", location: "27.7250, 85.3200" } });
    expect(first.destLat).toBeCloseTo(27.725);
    await new Promise((r) => setTimeout(r, 300)); // the place is saved in the background
    const again = await createOrder(w.waiterA, { type: "DELIVERY", idempotencyKey: `k-${uid()}-${stamp}`, delivery: { name: "Mina", phone: "9841000009", address: "blue gate, lakeside" } });
    expect(again.destLat).toBeCloseTo(27.725);
    const moved = await createOrder(w.waiterA, { type: "DELIVERY", idempotencyKey: `k-${uid()}-${stamp}`, delivery: { name: "Mina", phone: "9841000009", address: "New Road 12" } });
    expect(moved.destLat).toBeNull(); // different address: not sent to the old place (and no geocoder is configured)
  });
});
