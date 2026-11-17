import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { listNotifications, markRead } from "@/features/notifications/server/service";
import { setPushSender } from "@/features/notifications/server/push";
import { runScheduledAlerts } from "@/features/notifications/server/scheduled";
import {
  createPurchaseOrder,
  createSupplier,
  getPurchaseOrder,
  listPurchaseOrders,
  markOrdered,
  receiveDelivery,
  suggestedLines,
} from "@/features/purchasing/server/service";
import {
  createStockItem,
  getRecipes,
  listMovements,
  listStock,
  lowStockCount,
  recordCount,
  recordPurchase,
  recordWaste,
  setRecipe,
  updateStockItem,
} from "./service";
import { listTransferTargets, listTransfers, stockOverview, transferStock } from "./transfers";
import { itemAt } from "./test-support";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  owner: TenantContext;
  ownerB: TenantContext;
  managerA: TenantContext;
  waiterA: TenantContext;
  kitchenA: TenantContext;
  branchA: string;
  branchB: string;
  tea: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, manager, waiter, kitchen] = await Promise.all(["owner", "mgr", "wait", "kit"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const a = await db.branch.create({ data: { businessId: biz.id, name: "Branch A" } });
  const b = await db.branch.create({ data: { businessId: biz.id, name: "Branch B" } });
  for (const [u, role] of [[manager, "MANAGER"], [waiter, "WAITER"], [kitchen, "KITCHEN"]] as const) {
    await db.membership.create({ data: { userId: u.id, businessId: biz.id, role, allBranches: false, branches: { create: { branchId: a.id, businessId: biz.id } } } });
  }
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000 } });
  const ctx = (userId: string, role: TenantContext["role"], branchId: string, all = false): TenantContext => ({
    userId,
    businessId: biz.id,
    branchId,
    branchIds: all ? [a.id, b.id] : [a.id],
    role,
  });
  return {
    owner: ctx(owner.id, "OWNER", a.id, true),
    ownerB: ctx(owner.id, "OWNER", b.id, true),
    managerA: ctx(manager.id, "MANAGER", a.id),
    waiterA: ctx(waiter.id, "WAITER", a.id),
    kitchenA: ctx(kitchen.id, "KITCHEN", a.id),
    branchA: a.id,
    branchB: b.id,
    tea: tea.id,
  };
}

const qty = async (id: string, branchId: string) => (await itemAt(id, branchId)).quantity;
const stockOf = async (ctx: TenantContext, name: string) => (await listStock(ctx)).find((i) => i.name === name)!;
const buy = (ctx: TenantContext, itemId: string, quantity: number, totalCost = 0) =>
  recordPurchase(ctx, { supplier: "Test", lines: [{ stockItemId: itemId, quantity, totalCost }] });

let w: World;
let other: World;
const sent: { endpoint: string; body: { title: string } }[] = [];

beforeAll(async () => {
  w = await makeWorld("itest-stock-branch-a");
  other = await makeWorld("itest-stock-branch-b");
});

afterEach(() => setPushSender(null));

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.notificationRead.deleteMany({ where: { businessId: id } });
    await db.pushLog.deleteMany({ where: { businessId: id } });
    await db.pushSubscription.deleteMany({ where: { businessId: id } });
    await db.stockMovement.deleteMany({ where: { businessId: id } });
    await db.purchaseOrderLine.deleteMany({ where: { businessId: id } });
    await db.purchaseOrder.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("each branch has its own stock", () => {
  let flour: string;

  it("a new item appears in every branch, starting empty with the given reorder level", async () => {
    flour = (await createStockItem(w.owner, { name: "Flour", unit: "g", reorderLevel: 500 })).id;
    expect(await stockOf(w.owner, "Flour")).toMatchObject({ quantity: 0, reorderLevel: 500, status: "OUT" });
    expect(await stockOf(w.ownerB, "Flour")).toMatchObject({ quantity: 0, reorderLevel: 500 });
    // another business has nothing
    expect((await listStock(other.owner)).map((i) => i.name)).not.toContain("Flour");
  });

  it("buying, wasting and counting change only the branch you are in", async () => {
    await buy(w.owner, flour, 2_000, 4_000); // branch A: cost 2 per g -> 2000 milli
    expect(await qty(flour, w.branchA)).toBe(2_000);
    expect(await qty(flour, w.branchB)).toBe(0);

    await buy(w.ownerB, flour, 1_000, 5_000); // branch B pays more: its own average cost
    expect((await itemAt(flour, w.branchA)).costMilli).toBe(2_000);
    expect((await itemAt(flour, w.branchB)).costMilli).toBe(5_000);

    await recordWaste(w.ownerB, { stockItemId: flour, quantity: 100, reason: "spilled" });
    expect(await qty(flour, w.branchB)).toBe(900);
    expect(await qty(flour, w.branchA)).toBe(2_000);

    await recordCount(w.owner, { stockItemId: flour, counted: 1_900, note: "shelf count" });
    expect(await qty(flour, w.branchA)).toBe(1_900);
    expect(await qty(flour, w.branchB)).toBe(900);
  });

  it("the history of a branch shows only that branch's movements", async () => {
    const a = (await listMovements(w.owner)).map((m) => m.kind);
    const b = (await listMovements(w.ownerB)).map((m) => m.kind);
    expect(a.sort()).toEqual(["COUNT", "PURCHASE"]);
    expect(b.sort()).toEqual(["PURCHASE", "WASTE"]);
    const movesB = await db.stockMovement.findMany({ where: { businessId: w.owner.businessId, branchId: w.branchB } });
    expect(movesB.every((m) => m.branchId === w.branchB)).toBe(true);
  });

  it("the name is shared but the reorder level is per branch", async () => {
    await updateStockItem(w.ownerB, flour, { name: "Flour", reorderLevel: 100 });
    expect((await stockOf(w.ownerB, "Flour")).reorderLevel).toBe(100);
    expect((await stockOf(w.owner, "Flour")).reorderLevel).toBe(500);
    await updateStockItem(w.ownerB, flour, { name: "Plain flour", reorderLevel: 100 });
    expect((await stockOf(w.owner, "Flour".replace("Flour", "Plain flour"))).name).toBe("Plain flour"); // renamed everywhere
    await updateStockItem(w.ownerB, flour, { name: "Flour", reorderLevel: 100 });
  });

  it("low-stock counts are per branch", async () => {
    // A holds 1,900 (reorder 500) and B holds 900 (reorder 100): fine in both. Make A low.
    expect(await lowStockCount(w.owner)).toBe(0);
    await recordCount(w.owner, { stockItemId: flour, counted: 300, note: "low" });
    expect(await lowStockCount(w.owner)).toBe(1);
    expect(await lowStockCount(w.ownerB)).toBe(0);
    await recordCount(w.owner, { stockItemId: flour, counted: 1_900, note: "restored" });
  });

  it("a branch added later shows every item, empty", async () => {
    const c = await db.branch.create({ data: { businessId: w.owner.businessId, name: "Branch C" } });
    const atC: TenantContext = { ...w.owner, branchId: c.id, branchIds: [w.branchA, w.branchB, c.id] };
    expect(await stockOf(atC, "Flour")).toMatchObject({ quantity: 0, reorderLevel: 0 });
    await buy(atC, flour, 50, 100);
    expect(await qty(flour, c.id)).toBe(50);
    await db.branch.update({ where: { id: c.id }, data: { active: false } });
  });
});

describe("sales take stock from the branch that made them", () => {
  it("deducts at the invoice's branch only, at that branch's cost, and tells only that branch's staff", async () => {
    const sugar = await createStockItem(w.owner, { name: "Sugar", unit: "g", reorderLevel: 100 });
    await setRecipe(w.owner, w.tea, [{ stockItemId: sugar.id, quantity: 20 }]);
    await buy(w.owner, sugar.id, 1_000, 2_000);
    await buy(w.ownerB, sugar.id, 130, 1_300); // B is just above its reorder level after buying

    await db.pushSubscription.deleteMany({ where: { businessId: w.owner.businessId } });
    const mkSub = (ctx: TenantContext, tag: string) =>
      db.pushSubscription.create({ data: { userId: ctx.userId, businessId: ctx.businessId, endpoint: `https://push.example.test/${tag}-${stamp}`, p256dh: "B".repeat(87), auth: "A".repeat(22) } });
    await Promise.all([mkSub(w.kitchenA, "kitchenA"), mkSub(w.owner, "owner")]);
    sent.length = 0;
    setPushSender(async (s, payload) => {
      sent.push({ endpoint: s.endpoint, body: JSON.parse(payload) });
    });

    const order = await createOrder(w.ownerB, { type: "TAKEAWAY", idempotencyKey: `k-${uid()}-${stamp}` });
    await addItem(w.ownerB, order.id, { menuItemId: w.tea, quantity: 2 }); // 40 g of sugar
    const t = await previewBill(w.ownerB, order.id, { kind: "none" });
    const invoice = await checkout(w.ownerB, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });

    expect(invoice.branchId).toBe(w.branchB);
    expect(await qty(sugar.id, w.branchB)).toBe(90); // 130 - 40
    expect(await qty(sugar.id, w.branchA)).toBe(1_000); // untouched
    const movement = await db.stockMovement.findFirstOrThrow({ where: { invoiceId: invoice.id, stockItemId: sugar.id } });
    expect(movement).toMatchObject({ branchId: w.branchB, quantity: -40, unitCostMilli: 10_000 }); // B's own average cost

    // B went from fine to low: the owner (works in B) is told, the branch-A-only kitchen is not
    await new Promise((r) => setTimeout(r, 150));
    expect(sent.map((s) => s.body.title)).toEqual(["Stock is running low"]);
    expect(sent[0]!.endpoint).toContain("owner");
  });

  it("recipes show this branch's ingredient cost", async () => {
    const atA = (await getRecipes(w.owner)).find((d) => d.name === "Tea")!;
    const atB = (await getRecipes(w.ownerB)).find((d) => d.name === "Tea")!;
    expect(atA.recipe[0]!.stockItem.costMilli).toBe(2_000);
    expect(atB.recipe[0]!.stockItem.costMilli).toBe(10_000);
  });
});

describe("purchase orders belong to a branch", () => {
  let supplierId: string;
  let beans: string;
  let poId: string;

  it("an order for branch A cannot be seen or changed from branch B, and arrives in branch A", async () => {
    supplierId = (await createSupplier(w.owner, { name: "Hill Traders" })).id;
    beans = (await createStockItem(w.owner, { name: "Beans", unit: "g", reorderLevel: 1_000 })).id;

    const po = await createPurchaseOrder(w.owner, { supplierId, lines: [{ stockItemId: beans, quantity: 5_000, estimatedTotal: 10_000 }] });
    poId = po.id;
    expect(po.branchId).toBe(w.branchA);

    expect((await listPurchaseOrders(w.owner)).map((o) => o.id)).toContain(poId);
    expect((await listPurchaseOrders(w.ownerB)).map((o) => o.id)).not.toContain(poId);
    await expect(getPurchaseOrder(w.ownerB, poId)).rejects.toThrow(/not found/i);
    await expect(markOrdered(w.ownerB, poId)).rejects.toThrow(/not found/i);
    await expect(getPurchaseOrder(other.owner, poId)).rejects.toThrow(/not found/i);

    await markOrdered(w.owner, poId);
    const line = (await getPurchaseOrder(w.owner, poId)).lines[0]!;
    await expect(receiveDelivery(w.ownerB, poId, [{ lineId: line.id, quantity: 5_000, totalCost: 10_000 }])).rejects.toThrow(/not found/i);
    await receiveDelivery(w.owner, poId, [{ lineId: line.id, quantity: 5_000, totalCost: 10_000 }]);

    expect(await qty(beans, w.branchA)).toBe(5_000);
    expect(await qty(beans, w.branchB)).toBe(0);
    expect((await getPurchaseOrder(w.owner, poId)).branch.name).toBe("Branch A");
  });

  it("suggestions follow each branch's own levels and its own orders on the way", async () => {
    // A is now well stocked with beans, B has none and nothing on order
    const atA = await suggestedLines(w.owner);
    const atB = await suggestedLines(w.ownerB);
    expect(atA.map((s) => s.name)).not.toContain("Beans");
    expect(atB.map((s) => s.name)).toContain("Beans");

    // an order placed for A does not count as "on its way" for B
    const poA = await createPurchaseOrder(w.owner, { supplierId, lines: [{ stockItemId: beans, quantity: 9_000 }] });
    await markOrdered(w.owner, poA.id);
    expect((await suggestedLines(w.ownerB)).find((s) => s.name === "Beans")!.onOrder).toBe(0);
    const poB = await createPurchaseOrder(w.ownerB, { supplierId, lines: [{ stockItemId: beans, quantity: 4_000 }] });
    await markOrdered(w.ownerB, poB.id);
    expect((await suggestedLines(w.ownerB)).find((s) => s.name === "Beans")?.onOrder ?? 4_000).toBe(4_000);
    expect(poB.branchId).toBe(w.branchB);
  });
});

describe("transfers between branches", () => {
  let rice: string;

  it("an \"arrives straight away\" transfer moves stock and cost at once, with two history lines", async () => {
    rice = (await createStockItem(w.owner, { name: "Rice", unit: "g", reorderLevel: 0 })).id;
    await buy(w.owner, rice, 1_000, 2_000); // A: 1,000 g at 2000 milli
    await buy(w.ownerB, rice, 100, 400); // B: 100 g at 4000 milli

    await transferStock(w.owner, { toBranchId: w.branchB, stockItemId: rice, quantity: 300, note: "weekly top-up", arrivesNow: true });
    expect(await qty(rice, w.branchA)).toBe(700);
    expect(await qty(rice, w.branchB)).toBe(400);
    // B's average cost: (100 x 4000 + 300 x 2000) / 400 = 2500 milli; A's is unchanged
    expect((await itemAt(rice, w.branchB)).costMilli).toBe(2_500);
    expect((await itemAt(rice, w.branchA)).costMilli).toBe(2_000);

    const out = await db.stockMovement.findFirstOrThrow({ where: { stockItemId: rice, kind: "TRANSFER_OUT" } });
    const inn = await db.stockMovement.findFirstOrThrow({ where: { stockItemId: rice, kind: "TRANSFER_IN" } });
    expect(out).toMatchObject({ branchId: w.branchA, quantity: -300, totalCost: -600 });
    expect(inn).toMatchObject({ branchId: w.branchB, quantity: 300, totalCost: 600 });
    expect(out.note).toContain("To Branch B");
    expect(inn.note).toContain("From Branch A");

    const sentList = await listTransfers(w.owner);
    const receivedList = await listTransfers(w.ownerB);
    expect(sentList[0]).toMatchObject({ direction: "OUT", quantity: 300, note: "weekly top-up" });
    expect(receivedList[0]).toMatchObject({ direction: "IN", quantity: 300 });
  });

  it("cannot send more than the branch has, to itself, to a closed or foreign branch, or nothing", async () => {
    await expect(transferStock(w.owner, { toBranchId: w.branchB, stockItemId: rice, quantity: 701 })).rejects.toThrow(/only has 700/);
    await expect(transferStock(w.owner, { toBranchId: w.branchA, stockItemId: rice, quantity: 1 })).rejects.toThrow(/different branch/i);
    await expect(transferStock(w.owner, { toBranchId: w.branchB, stockItemId: rice, quantity: 0 })).rejects.toThrow(/quantity/i);
    await expect(transferStock(w.owner, { toBranchId: w.branchB, stockItemId: rice, quantity: 1.5 })).rejects.toThrow(/quantity/i);
    await expect(transferStock(w.owner, { toBranchId: other.branchA, stockItemId: rice, quantity: 1 })).rejects.toThrow(/not available/i);
    await expect(transferStock(other.owner, { toBranchId: other.branchB, stockItemId: rice, quantity: 1 })).rejects.toThrow(/not found/i);
    const closed = await db.branch.create({ data: { businessId: w.owner.businessId, name: "Closed", active: false } });
    await expect(transferStock(w.owner, { toBranchId: closed.id, stockItemId: rice, quantity: 1 })).rejects.toThrow(/not available/i);
    // a below-zero count cannot be sent either
    await db.branchStock.update({ where: { branchId_stockItemId: { branchId: w.branchA, stockItemId: rice } }, data: { quantity: -5 } });
    await expect(transferStock(w.owner, { toBranchId: w.branchB, stockItemId: rice, quantity: 1 })).rejects.toThrow(/only has 0/);
    await db.branchStock.update({ where: { branchId_stockItemId: { branchId: w.branchA, stockItemId: rice } }, data: { quantity: 700 } });
    // nothing moved
    expect(await qty(rice, w.branchB)).toBe(400);
  });

  it("is for people who manage stock, and two sends at once cannot overdraw the branch", async () => {
    await expect(transferStock(w.waiterA, { toBranchId: w.branchB, stockItemId: rice, quantity: 1 })).rejects.toThrow(/permission/i);
    await expect(transferStock(w.kitchenA, { toBranchId: w.branchB, stockItemId: rice, quantity: 1 })).rejects.toThrow(/permission/i);

    const results = await Promise.allSettled([
      transferStock(w.owner, { toBranchId: w.branchB, stockItemId: rice, quantity: 500, arrivesNow: true }),
      transferStock(w.managerA, { toBranchId: w.branchB, stockItemId: rice, quantity: 500, arrivesNow: true }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await qty(rice, w.branchA)).toBe(200);
    expect(await qty(rice, w.branchB)).toBe(900);
  });

  it("anyone who sees stock can see the transfers, and the choice of where to send excludes the current branch", async () => {
    expect((await listTransfers(w.kitchenA)).length).toBeGreaterThan(0);
    expect((await listTransferTargets(w.owner)).map((b) => b.id)).toEqual([w.branchB]);
    await expect(listTransfers(w.waiterA)).rejects.toThrow(/permission/i);
  });
});

describe("seeing all branches", () => {
  it("shows each branch's levels side by side, only for branches the person works in", async () => {
    const all = await stockOverview(w.owner);
    expect(all.branches.map((b) => b.id)).toEqual([w.branchA, w.branchB]);
    const rice = all.rows.find((r) => r.name === "Rice")!;
    expect(rice.perBranch.map((p) => p.quantity)).toEqual([200, 900]);

    // a manager limited to branch A sees one column
    const mine = await stockOverview(w.managerA);
    expect(mine.branches.map((b) => b.id)).toEqual([w.branchA]);
    expect(mine.rows.find((r) => r.name === "Rice")!.perBranch).toHaveLength(1);

    // another business sees none of ours
    const theirs = await stockOverview(other.owner);
    expect(theirs.rows.map((r) => r.name)).not.toContain("Rice");
    await expect(stockOverview(w.waiterA)).rejects.toThrow(/permission/i);
  });
});

describe("alerts and notifications by branch", () => {
  it("a low item notifies only the branch where it is low, and reading it there does not hide it elsewhere", async () => {
    const salt = await createStockItem(w.owner, { name: "Salt", unit: "g", reorderLevel: 100 });
    await buy(w.ownerB, salt.id, 1_000, 100); // B is fine; A has none (reorder 100): low in A only
    const atA = (await listNotifications(w.owner)).filter((x) => x.kind === "LOW_STOCK" && x.title.includes("Salt"));
    const atB = (await listNotifications(w.ownerB)).filter((x) => x.kind === "LOW_STOCK" && x.title.includes("Salt"));
    expect(atA).toHaveLength(1);
    expect(atB).toHaveLength(0);
    expect(atA[0]!.id).toContain(w.branchA);

    // make it low in B too: reading A's does not mark B's read (they are different notifications)
    await recordCount(w.ownerB, { stockItemId: salt.id, counted: 5, note: "low" });
    await markRead(w.owner, [atA[0]!.id]);
    const nowB = (await listNotifications(w.ownerB)).find((x) => x.title.includes("Salt"))!;
    expect(nowB.read).toBe(false);
    expect((await listNotifications(w.owner)).find((x) => x.title.includes("Salt"))!.read).toBe(true);
  });

  it("the daily reminder goes to each branch's own team, once", async () => {
    await db.pushLog.deleteMany({ where: { businessId: w.owner.businessId } });
    await db.pushSubscription.deleteMany({ where: { businessId: w.owner.businessId } });
    await db.pushSubscription.createMany({
      data: [
        { userId: w.kitchenA.userId, businessId: w.owner.businessId, endpoint: `https://push.example.test/kA2-${stamp}`, p256dh: "B".repeat(87), auth: "A".repeat(22) },
      ],
    });
    // only branch A's staff are subscribed; make sure B's low items do not reach them
    await db.branchStock.updateMany({ where: { businessId: w.owner.businessId, branchId: w.branchA }, data: { quantity: 100_000 } });
    sent.length = 0;
    setPushSender(async (s, payload) => {
      sent.push({ endpoint: s.endpoint, body: JSON.parse(payload) });
    });
    await runScheduledAlerts();
    expect(sent.filter((s) => s.endpoint.includes("kA2-"))).toHaveLength(0); // branch A is fully stocked now: nothing to say to its team
  });
});
