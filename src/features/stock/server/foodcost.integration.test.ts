import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createOrder, addItem, previewBill, checkout } from "@/features/orders/server/service";
import { createStockItem, recordPurchase, recordWaste, setRecipe } from "@/features/stock/server/service";
import { getAuditTrail } from "@/features/accounting/server/registers";
import { getBalanceSheet, getLedger } from "@/features/accounting/server/service";
import { postStockValue } from "@/features/accounting/server/extras";
import { localDate } from "@/lib/business-day";
import { getFoodCostReport } from "./foodcost";

const stamp = Date.now();
let n = 0;
const key = () => `fc-${stamp}-${++n}`;
let owner: TenantContext;
let cashier: TenantContext;
let businessId: string;
let momo: string;
let tea: string;
let today: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `fc-${stamp}@it.test`, name: "FC", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-fc-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId, name: "Food" } });
  momo = (await db.menuItem.create({ data: { businessId, categoryId: cat.id, name: "Momo", price: 20_000 } })).id;
  tea = (await db.menuItem.create({ data: { businessId, categoryId: cat.id, name: "Tea", price: 5_000 } })).id;
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  cashier = { ...base, role: "CASHIER" };
  today = localDate(new Date(), biz.timezone);
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.journalLine.deleteMany({ where: { businessId } });
  await db.journalEntry.deleteMany({ where: { businessId } });
  await db.account.deleteMany({ where: { businessId } });
  await db.stockMovement.deleteMany({ where: { businessId } });
  await db.recipeLine.deleteMany({ where: { businessId } });
  await db.printJob.deleteMany({ where: { businessId } });
  await db.payment.deleteMany({ where: { businessId } });
  await db.invoice.deleteMany({ where: { businessId } });
  await db.orderItem.deleteMany({ where: { businessId } });
  await db.order.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

async function sell(item: string, qty: number) {
  const order = await createOrder(owner, { type: "TAKEAWAY", idempotencyKey: key() });
  await addItem(owner, order.id, { menuItemId: item, quantity: qty });
  const t = await previewBill(owner, order.id, { kind: "none" });
  await checkout(owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
}

describe("food cost", () => {
  it("works out food cost %, per-dish cost and the kind of each dish from real sales and recipes", async () => {
    const flour = await createStockItem(owner, { name: "Flour", unit: "g", reorderLevel: 0 });
    // 10,000 g bought for Rs 500: 5 paisa per gram.
    await recordPurchase(owner, { lines: [{ stockItemId: flour.id, quantity: 10_000, totalCost: 50_000 }] });
    await setRecipe(owner, momo, [{ stockItemId: flour.id, quantity: 400 }]); // Rs 20 a plate
    await sell(momo, 3); // sold at Rs 200 each, before VAT
    await sell(tea, 2); // no recipe

    const r = await getFoodCostReport(owner, { from: today, to: today });
    const m = r.rows.find((x) => x.menuItemId === momo)!;
    expect(m.quantity).toBe(3);
    expect(m.unitCost).toBe(2_000);
    expect(m.cost).toBe(6_000);
    expect(m.costPercent).toBe(10);
    const t = r.rows.find((x) => x.menuItemId === tea)!;
    expect(t.klass).toBe("NO_RECIPE");
    // What the kitchen really used equals what the recipe says, so the percentages agree.
    expect(r.totals.usedBySales).toBe(6_000);
    expect(r.totals.foodCostPercent).toBe(Math.round((6_000 / r.totals.netSales) * 1000) / 10);
    expect(r.totals.noRecipeShare).toBeGreaterThan(0);

    await recordWaste(owner, { stockItemId: flour.id, quantity: 200, reason: "spilled" });
    const after = await getFoodCostReport(owner, { from: today, to: today });
    expect(after.totals.waste).toBe(1_000);
    expect(after.totals.trueCostPercent!).toBeGreaterThan(after.totals.foodCostPercent!);
  });

  it("only owners and managers see it, and bad dates are refused", async () => {
    await expect(getFoodCostReport(cashier)).rejects.toThrow(/permission/);
    await expect(getFoodCostReport(owner, { from: "2026-02-01", to: "2026-01-01" })).rejects.toThrow(/start date/);
    await expect(getFoodCostReport(owner, { from: "2020-01-01", to: "2026-01-01" })).rejects.toThrow(/year or less/);
  });
});

describe("stock value in the books", () => {
  it("brings the stock account in line with the shelves, once, and the books still balance", async () => {
    // Flour left: 10,000 - 1,200 used by sales - 200 wasted = 8,600 g at 5 paisa = Rs 430.
    const first = await postStockValue(owner);
    expect(first.value).toBe(43_000);
    expect(first.posted).toBe(43_000);
    expect((await postStockValue(owner)).posted).toBe(0);
    const inv = await db.account.findFirstOrThrow({ where: { businessId, key: "INVENTORY" } });
    expect((await getLedger(owner, inv.id, today, today)).closing).toBe(43_000);
    expect((await getBalanceSheet(owner, today)).difference).toBe(0);
    // Using more stock lowers the value, and the next post takes the difference back out.
    await sell(momo, 1);
    const next = await postStockValue(owner);
    expect(next.posted).toBe(-2_000);
    await expect(postStockValue(cashier)).rejects.toThrow(/owner/);
    const trail = await getAuditTrail(owner, { from: today, to: today, action: "stock." });
    expect(trail.some((e) => e.action === "stock.valuePost")).toBe(true);
  });
});
