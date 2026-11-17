import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addItem, checkout, createOrder, listMenu, previewBill } from "@/features/orders/server/service";
import { acceptSubmission, getGuestView, openSession, submitOrder } from "@/features/guest/server/service";
import { listNotifications } from "@/features/notifications/server/service";
import { setPushSender } from "@/features/notifications/server/push";
import { createPurchaseOrder, createSupplier, suggestedLines } from "@/features/purchasing/server/service";
import { getBranchMenuAdmin, setBranchMenuItem } from "@/features/menu/server/branch-menu";
import {
  createStockItem,
  listNotStockedHere,
  listStock,
  lowStockCount,
  recordCount,
  recordPurchase,
  recordWaste,
  setRecipe,
  setStockedHere,
} from "./service";
import { cancelTransfer, listIncoming, listTransfers, receiveTransfer, stockOverview, transferStock } from "./transfers";
import { getStockValueReport } from "./report";
import { itemAt } from "./test-support";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  owner: TenantContext;
  ownerB: TenantContext;
  managerA: TenantContext;
  managerB: TenantContext;
  cashierA: TenantContext;
  waiterA: TenantContext;
  kitchenA: TenantContext;
  branchA: string;
  branchB: string;
  tableTokenB: string;
  tea: string;
  cake: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, mA, mB, cashier, waiter, kitchen] = await Promise.all(["owner", "mgrA", "mgrB", "cash", "wait", "kit"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const a = await db.branch.create({ data: { businessId: biz.id, name: "Branch A" } });
  const b = await db.branch.create({ data: { businessId: biz.id, name: "Branch B" } });
  const join = (u: { id: string }, role: "MANAGER" | "CASHIER" | "WAITER" | "KITCHEN", branchId: string) =>
    db.membership.create({ data: { userId: u.id, businessId: biz.id, role, allBranches: false, branches: { create: { branchId, businessId: biz.id } } } });
  await Promise.all([join(mA, "MANAGER", a.id), join(mB, "MANAGER", b.id), join(cashier, "CASHIER", a.id), join(waiter, "WAITER", a.id), join(kitchen, "KITCHEN", a.id)]);
  const area = await db.area.create({ data: { businessId: biz.id, branchId: b.id, name: "Main" } });
  const table = await db.diningTable.create({ data: { businessId: biz.id, branchId: b.id, areaId: area.id, label: "B1" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000 } });
  const cake = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Cake", price: 15_000 } });
  const ctx = (userId: string, role: TenantContext["role"], branchId: string, all = false): TenantContext => ({ userId, businessId: biz.id, branchId, branchIds: all ? [a.id, b.id] : [branchId], role });
  return {
    owner: ctx(owner.id, "OWNER", a.id, true),
    ownerB: ctx(owner.id, "OWNER", b.id, true),
    managerA: ctx(mA.id, "MANAGER", a.id),
    managerB: ctx(mB.id, "MANAGER", b.id),
    cashierA: ctx(cashier.id, "CASHIER", a.id),
    waiterA: ctx(waiter.id, "WAITER", a.id),
    kitchenA: ctx(kitchen.id, "KITCHEN", a.id),
    branchA: a.id,
    branchB: b.id,
    tableTokenB: table.publicToken,
    tea: tea.id,
    cake: cake.id,
  };
}

const qty = async (id: string, branchId: string) => (await itemAt(id, branchId)).quantity;
const buy = (ctx: TenantContext, itemId: string, quantity: number, totalCost = 0) =>
  recordPurchase(ctx, { supplier: "Test", lines: [{ stockItemId: itemId, quantity, totalCost }] });
const mkItem = (ctx: TenantContext, name: string, reorderLevel = 0) => createStockItem(ctx, { name, unit: "g", reorderLevel });

let w: World;
let other: World;
const sent: { endpoint: string; body: { title: string; body: string } }[] = [];

beforeAll(async () => {
  w = await makeWorld("itest-transit-a");
  other = await makeWorld("itest-transit-b");
});

afterEach(() => setPushSender(null));

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.notificationRead.deleteMany({ where: { businessId: id } });
    await db.pushSubscription.deleteMany({ where: { businessId: id } });
    await db.stockMovement.deleteMany({ where: { businessId: id } });
    await db.purchaseOrderLine.deleteMany({ where: { businessId: id } });
    await db.purchaseOrder.deleteMany({ where: { businessId: id } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.guestSubmission.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("stock in transit", () => {
  let oil: string;

  it("leaves the sender at once and belongs to nobody until it is booked in", async () => {
    oil = (await mkItem(w.owner, "Oil")).id;
    await buy(w.owner, oil, 1_000, 3_000); // A: 1,000 at 3000 milli
    await buy(w.ownerB, oil, 100, 200); //   B: 100 at 2000 milli

    await db.pushSubscription.create({
      data: { userId: w.managerB.userId, businessId: w.owner.businessId, endpoint: `https://push.example.test/mgrB-${stamp}`, p256dh: "B".repeat(87), auth: "A".repeat(22) },
    });
    sent.length = 0;
    setPushSender(async (s, payload) => {
      sent.push({ endpoint: s.endpoint, body: JSON.parse(payload) });
    });
    const t = await transferStock(w.owner, { toBranchId: w.branchB, stockItemId: oil, quantity: 400, note: "weekly" });
    expect(t.status).toBe("IN_TRANSIT");
    expect(await qty(oil, w.branchA)).toBe(600);
    expect(await qty(oil, w.branchB)).toBe(100); // not yet
    expect(await db.stockMovement.count({ where: { stockItemId: oil, kind: "TRANSFER_OUT" } })).toBe(1);
    expect(await db.stockMovement.count({ where: { stockItemId: oil, kind: "TRANSFER_IN" } })).toBe(0);

    // the other branch's stock people are told, even with the app closed
    await new Promise((r) => setTimeout(r, 150));
    expect(sent.map((s) => s.body.title)).toEqual(["Stock is on its way"]);
    expect(sent[0]!.body.body).toContain("Oil");

    // it shows as on the way at the destination and in its notifications (for people who book stock in)
    expect((await listIncoming(w.managerB)).map((x) => x.id)).toEqual([t.id]);
    expect((await stockOverview(w.ownerB)).rows.find((r) => r.name === "Oil")!.perBranch.find((p) => p.branchId === w.branchB)!.onTheWay).toBe(400);
    expect((await listNotifications(w.managerB)).some((x) => x.kind === "STOCK_ARRIVING" && x.title.includes("Oil"))).toBe(true);
    expect((await listNotifications(w.waiterA)).some((x) => x.kind === "STOCK_ARRIVING")).toBe(false);
  });

  it("is booked in by the receiving branch only, once, folding in its cost", async () => {
    const t = (await listIncoming(w.managerB))[0]!;
    await expect(receiveTransfer(w.managerA, t.id)).rejects.toThrow(/not found/i); // the sender's branch cannot receive it
    await expect(receiveTransfer(other.owner, t.id)).rejects.toThrow(/not found/i);
    await expect(receiveTransfer(w.waiterA, t.id)).rejects.toThrow(/permission/i);
    await expect(receiveTransfer(w.managerB, t.id, 401)).rejects.toThrow(/from 0 to 400/);
    await expect(receiveTransfer(w.managerB, t.id, -1)).rejects.toThrow(/from 0 to 400/);
    await expect(receiveTransfer(w.managerB, t.id, 1.5)).rejects.toThrow(/from 0 to 400/);

    await receiveTransfer(w.managerB, t.id);
    expect(await qty(oil, w.branchB)).toBe(500);
    // B's average: (100 x 2000 + 400 x 3000) / 500 = 2800
    expect((await itemAt(oil, w.branchB)).costMilli).toBe(2_800);
    expect(await db.stockMovement.findFirstOrThrow({ where: { stockItemId: oil, kind: "TRANSFER_IN" } })).toMatchObject({ branchId: w.branchB, quantity: 400, totalCost: 1_200 });
    await expect(receiveTransfer(w.managerB, t.id)).rejects.toThrow(/already received/i);
    await expect(cancelTransfer(w.managerB, t.id)).rejects.toThrow(/already arrived/i);
    expect((await listIncoming(w.managerB)).length).toBe(0);
    expect((await listNotifications(w.managerB)).some((x) => x.kind === "STOCK_ARRIVING")).toBe(false);
  });

  it("records what was lost on the way when less arrives, and accepts none arriving", async () => {
    const short = await transferStock(w.owner, { toBranchId: w.branchB, stockItemId: oil, quantity: 100 });
    await receiveTransfer(w.managerB, short.id, 80);
    expect(await qty(oil, w.branchB)).toBe(580);
    const row = (await listTransfers(w.managerB)).find((x) => x.id === short.id)!;
    expect(row).toMatchObject({ status: "RECEIVED", receivedQuantity: 80, lost: 20 });

    const none = await transferStock(w.owner, { toBranchId: w.branchB, stockItemId: oil, quantity: 50 });
    await receiveTransfer(w.managerB, none.id, 0);
    expect(await qty(oil, w.branchB)).toBe(580);
    expect((await listTransfers(w.managerB)).find((x) => x.id === none.id)!.lost).toBe(50);
  });

  it("can be called off by either branch, and the stock goes back to the sender at its own cost", async () => {
    const before = await qty(oil, w.branchA);
    const t = await transferStock(w.owner, { toBranchId: w.branchB, stockItemId: oil, quantity: 30 });
    expect(await qty(oil, w.branchA)).toBe(before - 30);

    await expect(cancelTransfer(w.waiterA, t.id)).rejects.toThrow(/permission/i);
    await expect(cancelTransfer(other.owner, t.id)).rejects.toThrow(/not found/i);
    await cancelTransfer(w.managerB, t.id, "wrong item"); // the receiver refuses it
    expect(await qty(oil, w.branchA)).toBe(before);
    expect(await qty(oil, w.branchB)).toBe(580); // never arrived
    const back = await db.stockMovement.findFirstOrThrow({ where: { stockItemId: oil, branchId: w.branchA, note: { contains: "Returned" } } });
    expect(back).toMatchObject({ kind: "TRANSFER_IN", quantity: 30 });
    expect(back.note).toContain("wrong item");
    await expect(cancelTransfer(w.owner, t.id)).rejects.toThrow(/already cancelled/i);
    await expect(receiveTransfer(w.managerB, t.id)).rejects.toThrow(/cancelled/i);

    // the sender can call one off too
    const t2 = await transferStock(w.owner, { toBranchId: w.branchB, stockItemId: oil, quantity: 10 });
    await cancelTransfer(w.managerA, t2.id);
    expect(await qty(oil, w.branchA)).toBe(before);
  });

  it("receiving and cancelling at the same moment: only one wins, and stock is never counted twice", async () => {
    const aBefore = await qty(oil, w.branchA);
    const bBefore = await qty(oil, w.branchB);
    const t = await transferStock(w.owner, { toBranchId: w.branchB, stockItemId: oil, quantity: 100 });
    const results = await Promise.allSettled([receiveTransfer(w.managerB, t.id), cancelTransfer(w.managerA, t.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const aAfter = await qty(oil, w.branchA);
    const bAfter = await qty(oil, w.branchB);
    expect(aAfter + bAfter).toBe(aBefore + bBefore); // nothing created or lost
  });

  it("only the sender's side can send more than it holds nothing, and a branch that does not stock it refuses", async () => {
    await expect(transferStock(w.owner, { toBranchId: w.branchB, stockItemId: oil, quantity: 99_999 })).rejects.toThrow(/only has/);
  });
});

describe("items switched off for one branch", () => {
  let sugar: string;

  it("hides the item at that branch only, and only when it is empty and nothing is coming", async () => {
    sugar = (await mkItem(w.owner, "Sugar", 100)).id;
    await buy(w.owner, sugar, 500, 500);
    await expect(setStockedHere(w.waiterA, sugar, false)).rejects.toThrow(/permission/i);
    await expect(setStockedHere(w.ownerB, sugar, false)).resolves.toBeUndefined(); // B holds none: fine
    await expect(setStockedHere(w.owner, sugar, false)).rejects.toThrow(/still 500/); // A still has some

    expect((await listStock(w.ownerB)).map((i) => i.name)).not.toContain("Sugar");
    expect((await listStock(w.owner)).map((i) => i.name)).toContain("Sugar");
    expect((await listNotStockedHere(w.ownerB)).map((i) => i.name)).toEqual(["Sugar"]);
    expect(await lowStockCount(w.ownerB)).toBe(0); // it would be "out" otherwise
    expect((await listNotifications(w.ownerB)).some((x) => x.title.includes("Sugar"))).toBe(false);
    expect((await suggestedLines(w.ownerB)).map((x) => x.name)).not.toContain("Sugar");
  });

  it("cannot be bought, wasted, counted, ordered or received there until it is switched back on", async () => {
    await expect(buy(w.ownerB, sugar, 10, 10)).rejects.toThrow(/does not stock Sugar/);
    await expect(recordWaste(w.ownerB, { stockItemId: sugar, quantity: 1, reason: "spill" })).rejects.toThrow(/does not stock/);
    await expect(recordCount(w.ownerB, { stockItemId: sugar, counted: 5 })).rejects.toThrow(/does not stock/);
    const supplier = await createSupplier(w.owner, { name: "Sweet Co" });
    await expect(createPurchaseOrder(w.ownerB, { supplierId: supplier.id, lines: [{ stockItemId: sugar, quantity: 100 }] })).rejects.toThrow(/does not stock/);
    // and no one can send it there
    await expect(transferStock(w.owner, { toBranchId: w.branchB, stockItemId: sugar, quantity: 10 })).rejects.toThrow(/does not stock Sugar/);

    await setStockedHere(w.ownerB, sugar, true);
    expect((await listStock(w.ownerB)).map((i) => i.name)).toContain("Sugar");
    await buy(w.ownerB, sugar, 10, 10);
    expect(await qty(sugar, w.branchB)).toBe(10);
  });

  it("is refused while something is on its way to that branch, and a sale there leaves it alone when off", async () => {
    await recordCount(w.ownerB, { stockItemId: sugar, counted: 0 });
    const t = await transferStock(w.owner, { toBranchId: w.branchB, stockItemId: sugar, quantity: 20 });
    await expect(setStockedHere(w.ownerB, sugar, false)).rejects.toThrow(/on its way here/);
    await receiveTransfer(w.managerB, t.id);
    await recordCount(w.ownerB, { stockItemId: sugar, counted: 0 });
    await setStockedHere(w.ownerB, sugar, false);

    // a dish whose recipe uses Sugar is sold at B, which does not stock it: no movement, no negative level
    await setRecipe(w.owner, w.tea, [{ stockItemId: sugar, quantity: 10 }]);
    const o = await createOrder(w.ownerB, { type: "TAKEAWAY", idempotencyKey: `k-${uid()}-${stamp}` });
    await addItem(w.ownerB, o.id, { menuItemId: w.tea, quantity: 2 });
    const tot = await previewBill(w.ownerB, o.id, { kind: "none" });
    const inv = await checkout(w.ownerB, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: tot.grandTotal }] });
    expect(await db.stockMovement.count({ where: { invoiceId: inv.id } })).toBe(0);
    expect(await qty(sugar, w.branchB)).toBe(0);
    await setRecipe(w.owner, w.tea, []);
  });
});

describe("stock value across branches", () => {
  it("values each branch at its own average cost, shows what is on the way, and totals the business", async () => {
    const flour = (await mkItem(w.owner, "Flour")).id;
    await buy(w.owner, flour, 1_000, 2_000); // A: 1,000 g x 2000 milli = Rs 20.00 (2,000 paisa)
    await buy(w.ownerB, flour, 500, 2_500); //  B:   500 g x 5000 milli = Rs 25.00 (2,500 paisa)
    await transferStock(w.owner, { toBranchId: w.branchB, stockItemId: flour, quantity: 200 }); // 200 g on its way, valued at A's cost

    const report = await getStockValueReport(w.owner);
    const row = report.rows.find((r) => r.name === "Flour")!;
    expect(row.perBranch.map((p) => [p.quantity, p.value])).toEqual([[800, 1_600], [500, 2_500]]);
    expect(row.totalQuantity).toBe(1_300);
    expect(row.totalValue).toBe(4_100);
    expect(row.avgCostMilli).toBe(Math.round((4_100 * 1000) / 1_300));
    const a = report.branches.find((b) => b.id === w.branchA)!;
    const b = report.branches.find((b) => b.id === w.branchB)!;
    expect(b.onTheWayValue).toBe(400); // 200 g x 2000 milli
    expect(report.totals.onTheWayValue).toBeGreaterThanOrEqual(400);
    expect(a.value + b.value).toBe(report.totals.value);
    // what was bought in the period shows as cost
    expect(a.costs.purchases).toBeGreaterThanOrEqual(2_000);
    expect(b.costs.purchases).toBeGreaterThanOrEqual(2_500);
  });

  it("counts stock below zero as nothing but flags it, and leaves out items a branch does not stock", async () => {
    const yeast = (await mkItem(w.owner, "Yeast")).id;
    await buy(w.owner, yeast, 100, 1_000);
    await db.branchStock.update({ where: { branchId_stockItemId: { branchId: w.branchB, stockItemId: yeast } }, data: { quantity: -50, costMilli: 9_000 } });
    const r1 = await getStockValueReport(w.owner);
    const row = r1.rows.find((x) => x.name === "Yeast")!;
    expect(row.perBranch[1]).toMatchObject({ quantity: -50, value: 0 });
    expect(row.belowZero).toBe(true);
    expect(r1.branches.find((x) => x.id === w.branchB)!.belowZeroItems).toBeGreaterThanOrEqual(1);

    await db.branchStock.update({ where: { branchId_stockItemId: { branchId: w.branchB, stockItemId: yeast } }, data: { quantity: 0, active: false } });
    const r2 = await getStockValueReport(w.owner);
    expect(r2.rows.find((x) => x.name === "Yeast")!.perBranch[1]).toMatchObject({ stocked: false, value: 0 });
  });

  it("adds up costs for a period: sales, waste, counts, transfers, and what was lost in transit", async () => {
    const rice = (await mkItem(w.owner, "Rice")).id;
    await buy(w.owner, rice, 1_000, 10_000); // 10,000 milli each
    await recordWaste(w.owner, { stockItemId: rice, quantity: 100, reason: "spoiled" }); // 1,000 paisa
    await recordCount(w.owner, { stockItemId: rice, counted: 850, note: "short" }); // -50 g = -500
    const t = await transferStock(w.owner, { toBranchId: w.branchB, stockItemId: rice, quantity: 200 });
    await receiveTransfer(w.managerB, t.id, 150); // 50 g lost = 500

    const r = await getStockValueReport(w.owner);
    const a = r.branches.find((x) => x.id === w.branchA)!.costs;
    const b = r.branches.find((x) => x.id === w.branchB)!.costs;
    expect(a.waste).toBeGreaterThanOrEqual(1_000);
    expect(a.countAdjustments).toBeLessThanOrEqual(-500);
    expect(a.sentOut).toBeGreaterThanOrEqual(2_000);
    expect(b.receivedIn).toBeGreaterThanOrEqual(1_500);
    expect(b.lostInTransit).toBeGreaterThanOrEqual(500);

    // a period in the past has none of it
    const past = await getStockValueReport(w.owner, { from: "2020-01-01", to: "2020-01-31" });
    expect(past.totals.costs).toEqual({ purchases: 0, usedBySales: 0, waste: 0, countAdjustments: 0, sentOut: 0, receivedIn: 0, lostInTransit: 0 });
    expect(past.totals.value).toBeGreaterThan(0); // but the shelves are worth the same now
  });

  it("is for owners and managers, limited to the branches they work in, and is private to the business", async () => {
    for (const bad of [w.cashierA, w.waiterA, w.kitchenA]) await expect(getStockValueReport(bad)).rejects.toThrow(/permission/i);
    const mine = await getStockValueReport(w.managerA);
    expect(mine.branches.map((x) => x.id)).toEqual([w.branchA]);
    expect(mine.rows[0]!.perBranch).toHaveLength(1);
    const theirs = await getStockValueReport(other.owner);
    expect(theirs.rows.map((x) => x.name)).not.toContain("Flour");
    await expect(getStockValueReport(w.owner, { from: "2026-02-31" })).rejects.toThrow(/valid dates/i);
    await expect(getStockValueReport(w.owner, { from: "2026-05-02", to: "2026-05-01" })).rejects.toThrow(/not be after/i);
    await expect(getStockValueReport(w.owner, { from: "2020-01-01", to: "2026-01-01" })).rejects.toThrow(/year or less/i);
  });
});

describe("a menu per branch", () => {
  it("lets a branch set its own price and stop offering a dish, without touching the others", async () => {
    await expect(setBranchMenuItem(w.waiterA, w.tea, { price: 9_000, available: true })).rejects.toThrow(/permission/i);
    await expect(setBranchMenuItem(other.owner, w.tea, { price: 9_000, available: true })).rejects.toThrow(/not found/i);
    await expect(setBranchMenuItem(w.owner, w.tea, { price: -1, available: true })).rejects.toThrow(/price/i);
    await expect(setBranchMenuItem(w.owner, w.tea, { price: 1.5, available: true })).rejects.toThrow(/price/i);

    await setBranchMenuItem(w.owner, w.tea, { price: 9_000, available: true }); // Branch A charges more for tea
    await setBranchMenuItem(w.owner, w.cake, { price: null, available: false }); //  and does not sell cake

    const atA = (await listMenu(w.owner)).flatMap((c) => c.items);
    const atB = (await listMenu(w.ownerB)).flatMap((c) => c.items);
    expect(atA.find((i) => i.name === "Tea")!.price).toBe(9_000);
    expect(atA.map((i) => i.name)).not.toContain("Cake");
    expect(atB.find((i) => i.name === "Tea")!.price).toBe(8_000);
    expect(atB.map((i) => i.name)).toContain("Cake");

    const admin = (await getBranchMenuAdmin(w.owner)).categories.flatMap((c) => c.items);
    expect(admin.find((i) => i.name === "Tea")).toMatchObject({ basePrice: 8_000, branchPrice: 9_000 });
    expect(admin.find((i) => i.name === "Cake")).toMatchObject({ branchAvailable: false });
    expect((await getBranchMenuAdmin(w.ownerB)).categories.flatMap((c) => c.items).find((i) => i.name === "Cake")!.branchAvailable).toBe(true);
  });

  it("orders at the branch's price and refuses a dish the branch does not offer", async () => {
    const o = await createOrder(w.owner, { type: "TAKEAWAY", idempotencyKey: `k-${uid()}-${stamp}` });
    const line = await addItem(w.owner, o.id, { menuItemId: w.tea, quantity: 2 });
    expect(line.unitPrice).toBe(9_000);
    await expect(addItem(w.owner, o.id, { menuItemId: w.cake, quantity: 1 })).rejects.toThrow(/not offered at this branch/i);

    const ob = await createOrder(w.ownerB, { type: "TAKEAWAY", idempotencyKey: `k-${uid()}-${stamp}` });
    expect((await addItem(w.ownerB, ob.id, { menuItemId: w.tea, quantity: 1 })).unitPrice).toBe(8_000);
    await expect(addItem(w.ownerB, ob.id, { menuItemId: w.cake, quantity: 1 })).resolves.toBeDefined();
  });

  it("guests at a branch's tables see and pay that branch's prices", async () => {
    await setBranchMenuItem(w.ownerB, w.tea, { price: 7_000, available: true });
    await setBranchMenuItem(w.ownerB, w.cake, { price: null, available: false });
    const gc = await openSession(w.tableTokenB);
    const view = await getGuestView(gc);
    const items = view.menu.flatMap((c) => c.items);
    expect(items.find((i) => i.name === "Tea")!.price).toBe(7_000);
    expect(items.map((i) => i.name)).not.toContain("Cake");
    await expect(submitOrder(gc, { items: [{ menuItemId: w.cake, quantity: 1 }], idempotencyKey: `g-${uid()}-${stamp}` })).rejects.toThrow(/no longer available/i);

    const sub = await submitOrder(gc, { items: [{ menuItemId: w.tea, quantity: 2 }], idempotencyKey: `g-${uid()}-${stamp}` });
    expect((await db.guestSubmissionItem.findFirstOrThrow({ where: { submissionId: sub.id } })).unitPrice).toBe(7_000);
    await acceptSubmission(w.ownerB, sub.id);
    const line = await db.orderItem.findFirstOrThrow({ where: { businessId: w.owner.businessId, order: { branchId: w.branchB }, name: "Tea", unitPrice: 7_000 } });
    expect(line.quantity).toBe(2);

    // switching it off after the guest ordered: the accept is refused
    const sub2 = await submitOrder(gc, { items: [{ menuItemId: w.tea, quantity: 1 }], idempotencyKey: `g-${uid()}-${stamp}` });
    await setBranchMenuItem(w.ownerB, w.tea, { price: null, available: false });
    await expect(acceptSubmission(w.ownerB, sub2.id)).rejects.toThrow(/no longer available/i);
  });

  it("going back to the shared price and offering it again removes the override; the shared off switch still wins", async () => {
    await setBranchMenuItem(w.owner, w.tea, { price: null, available: true });
    await setBranchMenuItem(w.owner, w.cake, { price: 15_000, available: true }); // typed the shared price: same as no override
    expect(await db.branchMenuItem.count({ where: { branchId: w.branchA } })).toBe(0);
    expect((await listMenu(w.owner)).flatMap((c) => c.items).find((i) => i.name === "Tea")!.price).toBe(8_000);

    await db.menuItem.update({ where: { id: w.cake }, data: { available: false } });
    expect((await listMenu(w.owner)).flatMap((c) => c.items).map((i) => i.name)).not.toContain("Cake");
    expect((await listMenu(w.ownerB)).flatMap((c) => c.items).map((i) => i.name)).not.toContain("Cake");
    await db.menuItem.update({ where: { id: w.cake }, data: { available: true } });
  });
});
