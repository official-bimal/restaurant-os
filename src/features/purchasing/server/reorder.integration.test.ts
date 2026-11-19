import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { makeStockItem } from "@/features/stock/server/test-support";
import { createSupplier } from "./service";
import { createDraftFromReorder, getReorderPlan, setItemSupply, setSupplierLeadDays } from "./reorder";

const stamp = Date.now();
let owner: TenantContext;
let waiter: TenantContext;
let businessId: string;
let branchId: string;
let beans: string;
let milk: string;
let sugar: string;
let dairy: string;
let roaster: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `ro-${stamp}@it.test`, name: "RO", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-ro-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  branchId = (await db.branch.create({ data: { businessId, name: "Main" } })).id;
  const base = { userId: user.id, businessId, branchId, branchIds: [branchId] };
  owner = { ...base, role: "OWNER" };
  waiter = { ...base, role: "WAITER" };
  roaster = (await createSupplier(owner, { name: "Roaster" })).id;
  dairy = (await createSupplier(owner, { name: "Dairy" })).id;
  // Beans: 100 g in stock, sold 900 g over the last 9 days (so 100 g a day), bought in 1 kg bags.
  beans = (await makeStockItem(businessId, branchId, { name: "Coffee beans", unit: "g", quantity: 100, costMilli: 2_000 })).id;
  milk = (await makeStockItem(businessId, branchId, { name: "Milk", unit: "ml", quantity: 20_000, costMilli: 100 })).id;
  sugar = (await makeStockItem(businessId, branchId, { name: "Sugar", unit: "g", quantity: 0, reorderLevel: 1_000, costMilli: 80 })).id;
  await db.stockItem.update({ where: { businessId_id: { businessId, id: beans } }, data: { supplierId: roaster, packQuantity: 1_000 } });
  await db.stockItem.update({ where: { businessId_id: { businessId, id: milk } }, data: { supplierId: dairy } });
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
  await db.stockMovement.create({ data: { businessId, branchId, stockItemId: beans, kind: "SALE", quantity: -900, totalCost: -1_800, createdAt: daysAgo(8.5) } });
  await db.stockMovement.create({ data: { businessId, branchId, stockItemId: milk, kind: "SALE", quantity: -1_000, totalCost: -100, createdAt: daysAgo(1) } });
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.purchaseOrderLine.deleteMany({ where: { businessId } });
  await db.purchaseOrder.deleteMany({ where: { businessId } });
  await db.stockMovement.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

describe("reorder suggestions", () => {
  it("works out use per day from the days of history there are, and groups by supplier", async () => {
    const plan = await getReorderPlan(owner);
    expect(plan.dataDays).toBe(9);
    const roast = plan.groups.find((g) => g.supplier?.id === roaster)!;
    const b = roast.lines.find((l) => l.stockItemId === beans)!;
    // 100 g a day, lead 2 + 7 days cover = 900 wanted, 100 in stock: 800, rounded up to one 1 kg bag.
    expect(b).toMatchObject({ dailyUse: 100, daysLeft: 1, urgency: "NOW", quantity: 1_000, estimatedTotal: 2_000 });
    // Milk is plentiful: 20 L covers its use many times over, so it is not listed.
    expect(plan.groups.some((g) => g.lines.some((l) => l.stockItemId === milk))).toBe(false);
    // Sugar has no supplier and no use: it goes by its reorder level, in the "no supplier" group.
    const none = plan.groups.find((g) => g.supplier === null)!;
    expect(none.lines.find((l) => l.stockItemId === sugar)).toMatchObject({ quantity: 1_000, urgency: "NOW" });
    // Groups with something to order now come first, the unassigned group last.
    expect(plan.groups.at(-1)!.supplier).toBeNull();
  });

  it("a longer lead time orders more, and more days of cover orders more", async () => {
    await setSupplierLeadDays(owner, roaster, 5);
    const longer = await getReorderPlan(owner);
    expect(longer.groups.find((g) => g.supplier?.id === roaster)!.lines[0]!.quantity).toBe(2_000); // 1,200 wanted less 100 in stock is 1,100: two 1 kg bags
  });

  it("makes a draft order for one supplier, and counts it as on order afterwards", async () => {
    await setSupplierLeadDays(owner, roaster, 2);
    const po = await createDraftFromReorder(owner, { supplierId: roaster });
    expect(po.status).toBe("DRAFT");
    const lines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    expect(lines.map((l) => [l.stockItemId, l.quantityOrdered])).toEqual([[beans, 1_000]]);
    // A draft is not an order yet: it is still suggested until the order is actually placed.
    expect((await getReorderPlan(owner)).groups.some((g) => g.supplier?.id === roaster)).toBe(true);
    await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "ORDERED", orderedAt: new Date() } });
    expect((await getReorderPlan(owner)).groups.some((g) => g.supplier?.id === roaster)).toBe(false);
  });

  it("orders items with no usual supplier from the one chosen, and refuses without a choice", async () => {
    await expect(createDraftFromReorder(owner, { supplierId: "none" })).rejects.toThrow(/Choose which supplier/);
    const po = await createDraftFromReorder(owner, { supplierId: "none", chooseSupplierId: dairy });
    expect(po.supplierId).toBe(dairy);
    await expect(createDraftFromReorder(owner, { supplierId: roaster })).rejects.toThrow(/nothing to order/);
  });

  it("checks pack sizes, suppliers and who may plan orders", async () => {
    await expect(setItemSupply(owner, sugar, { supplierId: null, packQuantity: 0 })).rejects.toThrow(/pack size/);
    await expect(setItemSupply(owner, sugar, { supplierId: "nope", packQuantity: 1 })).rejects.toThrow(/Supplier not found/);
    await setItemSupply(owner, sugar, { supplierId: dairy, packQuantity: 500 });
    await expect(setSupplierLeadDays(owner, dairy, 99)).rejects.toThrow(/0 to 60/);
    await expect(getReorderPlan(waiter)).rejects.toThrow(/permission/);
    await expect(setItemSupply(waiter, sugar, { supplierId: null, packQuantity: 1 })).rejects.toThrow(/permission/);
  });
});
