import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createOrder, addItem, previewBill, checkout } from "@/features/orders/server/service";
import { deleteDeal, listDeals, saveDeal, setDealActive } from "./deals";

const stamp = Date.now();
let n = 0;
const key = () => `deal-${stamp}-${++n}`;
let owner: TenantContext;
let waiter: TenantContext;
let businessId: string;
let coffee: string;
let snack: string;
let coffeeCat: string;
let snackCat: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `deal-${stamp}@it.test`, name: "Deal", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-deal-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  coffeeCat = (await db.menuCategory.create({ data: { businessId, name: "Coffee" } })).id;
  snackCat = (await db.menuCategory.create({ data: { businessId, name: "Snack" } })).id;
  coffee = (await db.menuItem.create({ data: { businessId, categoryId: coffeeCat, name: "Latte", price: 20_000 } })).id;
  snack = (await db.menuItem.create({ data: { businessId, categoryId: snackCat, name: "Fries", price: 18_000 } })).id;
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  waiter = { ...base, role: "WAITER" };
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.printJob.deleteMany({ where: { businessId } });
  await db.payment.deleteMany({ where: { businessId } });
  await db.invoice.deleteMany({ where: { businessId } });
  await db.orderItem.deleteMany({ where: { businessId } });
  await db.order.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

const comboInput = { name: "Coffee and snack", kind: "COMBO", days: [], startMinute: null, endMinute: null, percentBps: 0, comboPrice: 30_000, branchId: null, items: [{ menuItemId: null, categoryId: "", quantity: 1 }, { menuItemId: null, categoryId: "", quantity: 1 }] };

async function order(...items: [string, number][]) {
  const o = await createOrder(owner, { type: "TAKEAWAY", idempotencyKey: key() });
  for (const [menuItemId, quantity] of items) await addItem(owner, o.id, { menuItemId, quantity });
  return o;
}

describe("automatic deals at the till", () => {
  it("applies a combo in the preview and stores it on the invoice, and the total follows", async () => {
    const deal = await saveDeal(owner, { ...comboInput, items: [{ menuItemId: null, categoryId: coffeeCat, quantity: 1 }, { menuItemId: null, categoryId: snackCat, quantity: 1 }] });
    const o = await order([coffee, 1], [snack, 1]);
    const t = await previewBill(owner, o.id, { kind: "none" });
    expect(t.deal).toEqual({ name: "Coffee and snack", amount: 8_000 });
    expect(t.discount).toBe(8_000);
    expect(t.subtotal).toBe(38_000);
    const inv = await checkout(owner, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    expect(inv.dealName).toBe("Coffee and snack");
    expect(inv.dealDiscount).toBe(8_000);
    expect(inv.discount).toBe(8_000);
    await setDealActive(owner, deal.id, false);
    const o2 = await order([coffee, 1], [snack, 1]);
    expect((await previewBill(owner, o2.id, { kind: "none" })).deal).toBeNull();
  });

  it("takes the cashier's own discount off after the deal, never beyond the bill", async () => {
    const d = await saveDeal(owner, { ...comboInput, name: "Latte 20%", kind: "PERCENT_OFF", comboPrice: 0, percentBps: 2_000, items: [{ menuItemId: coffee, categoryId: null, quantity: 1 }] });
    const o = await order([coffee, 1], [snack, 1]);
    const t = await previewBill(owner, o.id, { kind: "percent", bps: 1_000 });
    // deal: 20% of 20,000 = 4,000; then 10% of the remaining 34,000 = 3,400.
    expect(t.deal?.amount).toBe(4_000);
    expect(t.discount).toBe(7_400);
    const big = await previewBill(owner, o.id, { kind: "amount", amount: 999_999 });
    expect(big.discount).toBe(38_000);
    await deleteDeal(owner, d.id);
    expect((await previewBill(owner, o.id, { kind: "none" })).deal).toBeNull();
  });

  it("does nothing outside its days, and refuses bad deals", async () => {
    const other = (new Date().getDay() + 3) % 7; // a day that is not today (close enough: the deal is valid on one day only)
    await saveDeal(owner, { ...comboInput, name: "Sunday only", kind: "PERCENT_OFF", comboPrice: 0, percentBps: 5_000, days: [other], items: [] });
    const o = await order([coffee, 1]);
    // The test may run on any weekday, so check that the deal is on exactly when the weekday matches in the business's own time zone.
    const t = await previewBill(owner, o.id, { kind: "none" });
    const todayKathmandu = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kathmandu", weekday: "short" }).format(new Date());
    const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(todayKathmandu);
    expect(!!t.deal).toBe(dayIdx === other);
    await expect(saveDeal(owner, { ...comboInput, name: "", items: [] })).rejects.toThrow(/name/);
    await expect(saveDeal(owner, { ...comboInput, items: [] })).rejects.toThrow(/at least one/);
    await expect(saveDeal(owner, { ...comboInput, kind: "PERCENT_OFF", percentBps: 0, items: [] })).rejects.toThrow(/percentage/);
    await expect(saveDeal(owner, { ...comboInput, startMinute: 600, endMinute: null, items: [{ menuItemId: coffee, categoryId: null, quantity: 1 }] })).rejects.toThrow(/start and an end/);
    await expect(saveDeal(owner, { ...comboInput, items: [{ menuItemId: "nope-nope-nope", categoryId: null, quantity: 1 }] })).rejects.toThrow(/not found/);
  });

  it("only people who manage the menu set deals up", async () => {
    await expect(listDeals(waiter)).rejects.toThrow(/permission/);
    expect((await listDeals(owner)).length).toBeGreaterThan(0);
  });
});
