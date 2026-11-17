import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { itemAt } from "@/features/stock/server/test-support";
import type { TenantContext } from "@/server/auth";
import { addItem, cancelItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { refundInvoice } from "@/features/orders/server/void";
import { getDayReport } from "@/features/reports/server/service";
import { splitOrder } from "@/features/orders/server/table-ops";
import {
  archiveStockItem,
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

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  owner: TenantContext;
  manager: TenantContext;
  cashier: TenantContext;
  kitchen: TenantContext;
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
    kitchen: { ...base, role: "KITCHEN" },
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

async function pay(w: World, orderId: string) {
  const t = await previewBill(w.owner, orderId, { kind: "none" });
  return checkout(w.owner, orderId, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
}

const item = (id: string) => itemAt(id);

let a: World;
let b: World;
let flour: string;
let chicken: string;

beforeAll(async () => {
  a = await makeWorld("itest-stock-a");
  b = await makeWorld("itest-stock-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.refundPayment.deleteMany({ where: { businessId: id } });
    await db.creditNote.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.recipeLine.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("stock items", () => {
  it("creates items with a unit and reorder level, refusing bad input and duplicates in any case", async () => {
    flour = (await createStockItem(a.manager, { name: "  Flour ", unit: "g", reorderLevel: 2_000 })).id;
    chicken = (await createStockItem(a.owner, { name: "Chicken", unit: "g", reorderLevel: 0 })).id;
    expect((await item(flour)).name).toBe("Flour");
    await expect(createStockItem(a.owner, { name: "FLOUR", unit: "g", reorderLevel: 0 })).rejects.toThrow("already exists");
    await expect(createStockItem(a.owner, { name: "Salt", unit: "kg", reorderLevel: 0 })).rejects.toThrow("grams");
    await expect(createStockItem(a.owner, { name: "Salt", unit: "g", reorderLevel: -1 })).rejects.toThrow("reorder level");
    await expect(createStockItem(a.owner, { name: " ", unit: "g", reorderLevel: 0 })).rejects.toThrow("Name");
    await expect(createStockItem(b.owner, { name: "Flour", unit: "g", reorderLevel: 0 })).resolves.toBeTruthy(); // another business may reuse it
  });

  it("limits who can see and change stock", async () => {
    await expect(createStockItem(a.kitchen, { name: "X", unit: "g", reorderLevel: 0 })).rejects.toThrow("permission");
    await expect(createStockItem(a.cashier, { name: "X", unit: "g", reorderLevel: 0 })).rejects.toThrow("permission");
    await expect(listStock(a.waiter)).rejects.toThrow("permission");
    await expect(listStock(a.cashier)).rejects.toThrow("permission");
    await expect(listStock(a.kitchen)).resolves.toBeTruthy(); // the kitchen can look
    expect(await lowStockCount(a.waiter)).toBe(0);
  });

  it("keeps businesses apart", async () => {
    expect((await listStock(a.owner)).every((i) => i.businessId === a.owner.businessId)).toBe(true);
    await expect(updateStockItem(b.owner, flour, { name: "Hijack", reorderLevel: 0 })).rejects.toThrow("not found");
    await expect(recordWaste(b.owner, { stockItemId: flour, quantity: 1, reason: "not mine" })).rejects.toThrow("not found");
    await expect(recordCount(b.owner, { stockItemId: flour, counted: 5 })).rejects.toThrow("not found");
    await expect(archiveStockItem(b.owner, flour)).rejects.toThrow("not found");
    await expect(recordPurchase(b.owner, { lines: [{ stockItemId: flour, quantity: 5, totalCost: 100 }] })).rejects.toThrow("not found");
    expect((await item(flour)).quantity).toBe(0);
  });
});

describe("purchases and average cost", () => {
  it("adds to stock and blends the average cost, recording supplier and cost", async () => {
    await recordPurchase(a.manager, { supplier: "  Pokhara   Mill ", lines: [{ stockItemId: flour, quantity: 1000, totalCost: 80_000 }] });
    expect(await item(flour)).toMatchObject({ quantity: 1000, costMilli: 80_000 }); // Rs 0.80 a gram
    await recordPurchase(a.manager, { lines: [{ stockItemId: flour, quantity: 1000, totalCost: 100_000 }] });
    expect(await item(flour)).toMatchObject({ quantity: 2000, costMilli: 90_000 }); // blended
    const moves = await listMovements(a.manager, { stockItemId: flour });
    const first = moves.find((m) => m.supplier === "Pokhara Mill")!;
    expect(first).toMatchObject({ kind: "PURCHASE", quantity: 1000, totalCost: 80_000, unitCostMilli: 80_000 });
  });

  it("handles several lines, repeated items and a purchase for free", async () => {
    await recordPurchase(a.owner, {
      lines: [
        { stockItemId: chicken, quantity: 500, totalCost: 50_000 },
        { stockItemId: chicken, quantity: 500, totalCost: 70_000 },
      ],
    });
    expect(await item(chicken)).toMatchObject({ quantity: 1000, costMilli: 120_000 });
    await recordPurchase(a.owner, { lines: [{ stockItemId: chicken, quantity: 1000, totalCost: 0 }] }); // a gift
    expect((await item(chicken)).costMilli).toBe(60_000);
  });

  it("refuses empty, zero, negative and fractional input, and does not half-apply a bad purchase", async () => {
    const before = (await item(flour)).quantity;
    await expect(recordPurchase(a.owner, { lines: [] })).rejects.toThrow("at least one");
    await expect(recordPurchase(a.owner, { lines: [{ stockItemId: flour, quantity: 0, totalCost: 1 }] })).rejects.toThrow("whole number");
    await expect(recordPurchase(a.owner, { lines: [{ stockItemId: flour, quantity: 1.5, totalCost: 1 }] })).rejects.toThrow("whole number");
    await expect(recordPurchase(a.owner, { lines: [{ stockItemId: flour, quantity: 5, totalCost: -1 }] })).rejects.toThrow("cost");
    await expect(
      recordPurchase(a.owner, { lines: [{ stockItemId: flour, quantity: 100, totalCost: 100 }, { stockItemId: "missing", quantity: 1, totalCost: 1 }] }),
    ).rejects.toThrow("not found");
    expect((await item(flour)).quantity).toBe(before); // the good first line was rolled back too
  });
});

describe("waste and counts", () => {
  it("records waste at the average cost, needs a reason, and the kitchen may do it", async () => {
    const before = (await item(flour)).quantity;
    await recordWaste(a.kitchen, { stockItemId: flour, quantity: 100, reason: "Spilled bag" });
    expect((await item(flour)).quantity).toBe(before - 100);
    const m = (await listMovements(a.owner, { stockItemId: flour })).find((x) => x.kind === "WASTE")!;
    expect(m).toMatchObject({ quantity: -100, totalCost: -9_000, note: "Spilled bag" }); // 100 g x Rs 0.90
    await expect(recordWaste(a.kitchen, { stockItemId: flour, quantity: 5, reason: " " })).rejects.toThrow("reason");
    await expect(recordWaste(a.kitchen, { stockItemId: flour, quantity: 0, reason: "nothing" })).rejects.toThrow("whole number");
    await expect(recordWaste(a.cashier, { stockItemId: flour, quantity: 5, reason: "not allowed" })).rejects.toThrow("permission");
  });

  it("a count sets the quantity and records the difference, or nothing if it matches", async () => {
    const book = (await item(flour)).quantity; // 1900
    expect(await recordCount(a.manager, { stockItemId: flour, counted: 1_850, note: "Weekly count" })).toEqual({ difference: -50 });
    expect((await item(flour)).quantity).toBe(1_850);
    const m = (await listMovements(a.owner, { stockItemId: flour })).find((x) => x.kind === "COUNT")!;
    expect(m).toMatchObject({ quantity: -50, note: "Weekly count", totalCost: -4_500 });
    expect(await recordCount(a.manager, { stockItemId: flour, counted: 1_850 })).toEqual({ difference: 0 });
    expect((await listMovements(a.owner, { stockItemId: flour })).filter((x) => x.kind === "COUNT")).toHaveLength(1);
    expect(book).toBe(1_900);
    await expect(recordCount(a.kitchen, { stockItemId: flour, counted: 1 })).rejects.toThrow("permission");
    await expect(recordCount(a.manager, { stockItemId: flour, counted: -1 })).rejects.toThrow("whole number");
  });
});

describe("recipes", () => {
  it("sets, replaces and clears a recipe, and shows its ingredients", async () => {
    await setRecipe(a.manager, a.momo, [{ stockItemId: flour, quantity: 30 }, { stockItemId: chicken, quantity: 50 }]);
    let dish = (await getRecipes(a.manager)).find((d) => d.id === a.momo)!;
    expect(dish.recipe.map((r) => [r.stockItem.name, r.quantity]).sort()).toEqual([["Chicken", 50], ["Flour", 30]]);
    await setRecipe(a.manager, a.momo, [{ stockItemId: flour, quantity: 40 }, { stockItemId: chicken, quantity: 50 }]);
    dish = (await getRecipes(a.manager)).find((d) => d.id === a.momo)!;
    expect(dish.recipe).toHaveLength(2);
    expect(dish.recipe.find((r) => r.stockItem.name === "Flour")!.quantity).toBe(40);
    await setRecipe(a.manager, a.tea, [{ stockItemId: flour, quantity: 1 }]);
    await setRecipe(a.manager, a.tea, []);
    expect((await getRecipes(a.manager)).find((d) => d.id === a.tea)!.recipe).toHaveLength(0);
  });

  it("refuses bad recipes and other businesses' dishes or ingredients", async () => {
    await expect(setRecipe(a.manager, a.momo, [{ stockItemId: flour, quantity: 5 }, { stockItemId: flour, quantity: 6 }])).rejects.toThrow("once");
    await expect(setRecipe(a.manager, a.momo, [{ stockItemId: flour, quantity: 0 }])).rejects.toThrow("whole number");
    await expect(setRecipe(a.manager, a.momo, [{ stockItemId: "missing", quantity: 5 }])).rejects.toThrow("not found");
    await expect(setRecipe(b.owner, a.momo, [])).rejects.toThrow("Dish not found");
    const theirs = await createStockItem(b.owner, { name: "Rice", unit: "g", reorderLevel: 0 });
    await expect(setRecipe(a.manager, a.momo, [{ stockItemId: theirs.id, quantity: 5 }])).rejects.toThrow("not found");
    await expect(setRecipe(a.kitchen, a.momo, [])).rejects.toThrow("permission");
    expect((await getRecipes(a.manager)).find((d) => d.id === a.momo)!.recipe).toHaveLength(2); // unchanged
  });

  it("will not archive an item a recipe still uses", async () => {
    await expect(archiveStockItem(a.manager, flour)).rejects.toThrow("recipe still uses");
    const spare = await createStockItem(a.manager, { name: "Spare", unit: "piece", reorderLevel: 0 });
    await archiveStockItem(a.manager, spare.id);
    expect((await listStock(a.manager)).some((i) => i.id === spare.id)).toBe(false);
  });
});

describe("using stock when a bill is paid", () => {
  it("takes recipe amounts off, with cost and the invoice recorded, and leaves no-recipe dishes alone", async () => {
    const f0 = (await item(flour)).quantity;
    const c0 = (await item(chicken)).quantity;
    const order = await seat(a, [{ id: a.momo, qty: 4 }, { id: a.tea, qty: 3 }]); // tea has no recipe
    const inv = await pay(a, order.id);
    expect((await item(flour)).quantity).toBe(f0 - 4 * 40);
    expect((await item(chicken)).quantity).toBe(c0 - 4 * 50);
    const sales = await db.stockMovement.findMany({ where: { invoiceId: inv.id }, orderBy: { stockItem: { name: "asc" } } });
    expect(sales).toHaveLength(2); // one per ingredient, summed across the lines
    expect(sales.find((s) => s.stockItemId === flour)).toMatchObject({ kind: "SALE", quantity: -160, unitCostMilli: 90_000, totalCost: -14_400 });
  });

  it("does not use stock for cancelled items, and does for complimentary ones", async () => {
    const f0 = (await item(flour)).quantity;
    const order = await seat(a, [{ id: a.momo, qty: 2 }, { id: a.momo, qty: 5 }, { id: a.tea, qty: 1 }]);
    const lines = await db.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } });
    await cancelItem(a.manager, lines[1].id, "Wrong dish"); // 5 momo cancelled
    await db.orderItem.update({ where: { id: lines[0].id }, data: { complimentary: true } }); // 2 momo free, still cooked
    const inv = await pay(a, order.id); // only the tea is charged
    expect(inv.subtotal).toBe(8_000);
    expect(f0 - (await item(flour)).quantity).toBe(2 * 40);
  });

  it("goes negative instead of blocking a sale, and flags it", async () => {
    const lonely = (await createStockItem(a.owner, { name: `Lonely ${uid()}`, unit: "g", reorderLevel: 10 })).id;
    await setRecipe(a.manager, a.tea, [{ stockItemId: lonely, quantity: 25 }]);
    const inv = await pay(a, (await seat(a, [{ id: a.tea, qty: 2 }])).id);
    expect(inv.grandTotal).toBeGreaterThan(0); // the sale went through
    expect(await item(lonely)).toMatchObject({ quantity: -50 });
    expect((await listStock(a.manager)).find((i) => i.id === lonely)?.status).toBe("NEGATIVE");
    expect(await lowStockCount(a.manager)).toBeGreaterThan(0);
    await setRecipe(a.manager, a.tea, []);
  });

  it("uses nothing when the payment fails", async () => {
    const f0 = (await item(flour)).quantity;
    const before = new Date();
    const order = await seat(a, [{ id: a.momo, qty: 3 }]);
    await expect(checkout(a.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 1 }] })).rejects.toThrow("add up");
    expect((await item(flour)).quantity).toBe(f0);
    expect(await db.stockMovement.count({ where: { businessId: a.owner.businessId, kind: "SALE", createdAt: { gt: before } } })).toBe(0);
  });

  it("does not put stock back on a refund, and counts each split bill's food once", async () => {
    const f0 = (await item(flour)).quantity;
    const order = await seat(a, [{ id: a.momo, qty: 4 }]);
    const [line] = await db.orderItem.findMany({ where: { orderId: order.id } });
    const split = await splitOrder(a.manager, order.id, [{ itemId: line.id, quantity: 1 }], `split-${uid()}-${stamp}`);
    const i1 = await pay(a, order.id);
    await pay(a, split.id);
    expect(f0 - (await item(flour)).quantity).toBe(4 * 40); // all four portions, once
    await refundInvoice(a.manager, i1.id, "Customer unhappy");
    expect(f0 - (await item(flour)).quantity).toBe(4 * 40); // unchanged by the refund
  });

  it("keeps the cached quantity equal to the ledger", async () => {
    for (const id of [flour, chicken]) {
      const sum = await db.stockMovement.aggregate({ where: { stockItemId: id }, _sum: { quantity: true } });
      expect((await item(id)).quantity).toBe(sum._sum.quantity);
    }
  });
});

describe("food cost in the daily report", () => {
  it("equals the cost recorded on today's sales movements, and is not reduced by a refund", async () => {
    const sales = await db.stockMovement.aggregate({ where: { businessId: a.owner.businessId, kind: "SALE" }, _sum: { totalCost: true } });
    const { report } = await getDayReport(a.manager);
    expect(report.foodCost).toBe(-(sales._sum.totalCost ?? 0));
    expect(report.foodCost).toBeGreaterThan(0);
    expect(report.foodCostPercent).not.toBeNull();
    const other = await getDayReport(b.owner);
    expect(other.report.foodCost).toBe(0); // another business sees none of it
  });
});
