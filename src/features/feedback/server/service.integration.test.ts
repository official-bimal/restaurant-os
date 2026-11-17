import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { openSession } from "@/features/guest/server/service";
import { addItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { moveToTable } from "@/features/orders/server/table-ops";
import {
  dishRatingsFor,
  getDishRatingState,
  listDishRatings,
  getFeedbackSettings,
  getFeedbackState,
  submitDishRating,
  listFeedback,
  resolveFeedback,
  setFeedbackSettings,
  submitComment,
  submitRating,
  unresolvedCount,
} from "./service";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  owner: TenantContext;
  manager: TenantContext;
  cashier: TenantContext;
  waiter: TenantContext;
  areaId: string;
  momo: string;
}

async function makeWorld(name: string): Promise<World> {
  const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main branch" } });
  businessIds.push(biz.id);
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 20_000 } });
  const base = { userId: user.id, businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, role: "OWNER" },
    manager: { ...base, role: "MANAGER" },
    cashier: { ...base, role: "CASHIER" },
    waiter: { ...base, role: "WAITER" },
    areaId: area.id,
    momo: momo.id,
  };
}

/** A guest sits, orders and pays. Returns their sitting claims and the (still unpaid-or-paid) order. */
async function visit(w: World, { pay = true } = {}) {
  const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.owner.branchId, areaId: w.areaId, label: `T${uid()}` } });
  const claims = await openSession(table.publicToken);
  const order = await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
  await addItem(w.owner, order.id, { menuItemId: w.momo, quantity: 2 });
  let invoiceId: string | null = null;
  if (pay) {
    const t = await previewBill(w.owner, order.id, { kind: "none" });
    invoiceId = (await checkout(w.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] })).id;
  }
  return { claims: { sessionId: claims.sessionId, tableId: claims.tableId }, table, order, invoiceId };
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-fb-a");
  b = await makeWorld("itest-fb-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.feedback.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("a guest rating their visit", () => {
  it("is only possible after the bill is paid", async () => {
    const v = await visit(a, { pay: false });
    expect(await getFeedbackState(v.claims)).toBeNull();
    await expect(submitRating(v.claims, 5)).rejects.toThrow("has been paid");
    expect(await db.feedback.count({ where: { businessId: a.owner.businessId } })).toBe(0);
  });

  it("takes one rating per visit: a second tap updates it", async () => {
    const v = await visit(a);
    const state = await getFeedbackState(v.claims);
    expect(state).toMatchObject({ rating: null, canSubmit: true });
    await submitRating(v.claims, 5);
    await submitRating(v.claims, 2);
    const rows = await db.feedback.findMany({ where: { invoiceId: v.invoiceId! } });
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(2);
    expect(await getFeedbackState(v.claims)).toMatchObject({ rating: 2, lowRating: true });
  });

  it("rejects ratings outside one to five", async () => {
    const v = await visit(a);
    for (const bad of [0, 6, -1, 2.5, "5", null, undefined]) {
      await expect(submitRating(v.claims, bad), String(bad)).rejects.toThrow("one and five");
    }
    expect(await db.feedback.count({ where: { invoiceId: v.invoiceId! } })).toBe(0);
  });

  it("adds a cleaned comment after a rating, can clear it, and refuses one without a rating or too long", async () => {
    const v = await visit(a);
    await expect(submitComment(v.claims, "great")).rejects.toThrow("star rating first");
    await submitRating(v.claims, 3);
    await submitComment(v.claims, "  Food   was cold \n and slow ");
    expect((await getFeedbackState(v.claims))?.comment).toBe("Food was cold and slow");
    await expect(submitComment(v.claims, "x".repeat(501))).rejects.toThrow("under 500");
    await submitComment(v.claims, "   ");
    expect((await getFeedbackState(v.claims))?.comment).toBeNull();
  });

  it("closes 24 hours after paying", async () => {
    const v = await visit(a);
    await submitRating(v.claims, 4);
    await db.tableSession.update({ where: { id: v.claims.sessionId }, data: { closedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    expect((await getFeedbackState(v.claims))?.canSubmit).toBe(false);
    await expect(submitRating(v.claims, 1)).rejects.toThrow("has closed");
    await expect(submitComment(v.claims, "late")).rejects.toThrow("has closed");
    expect((await db.feedback.findFirstOrThrow({ where: { invoiceId: v.invoiceId! } })).rating).toBe(4);
  });

  it("cannot be used with another table's sitting, a moved sitting, or when switched off", async () => {
    const v = await visit(a);
    await expect(submitRating({ sessionId: v.claims.sessionId, tableId: "other" }, 5)).rejects.toThrow("has been paid");
    await expect(submitRating(null, 5)).rejects.toThrow("has been paid");

    // a sitting that ended because the party moved was never paid
    const moved = await visit(a, { pay: false });
    const free = await db.diningTable.create({ data: { businessId: a.owner.businessId, branchId: a.owner.branchId, areaId: a.areaId, label: `T${uid()}` } });
    await moveToTable(a.cashier, moved.order.id, free.id);
    await expect(submitRating(moved.claims, 5)).rejects.toThrow("has been paid");

    await setFeedbackSettings(a.owner, { enabled: false, googleReviewUrl: "" });
    expect(await getFeedbackState(v.claims)).toBeNull();
    await expect(submitRating(v.claims, 5)).rejects.toThrow("not being collected");
    await setFeedbackSettings(a.owner, { enabled: true, googleReviewUrl: "" });
  });

  it("offers the public review link to every rating, high or low (no review gating)", async () => {
    await setFeedbackSettings(a.owner, { enabled: true, googleReviewUrl: "https://g.page/r/test-cafe/review" });
    for (const rating of [1, 3, 5]) {
      const v = await visit(a);
      await submitRating(v.claims, rating);
      expect((await getFeedbackState(v.claims))?.googleReviewUrl).toBe("https://g.page/r/test-cafe/review");
    }
    await setFeedbackSettings(a.owner, { enabled: true, googleReviewUrl: "" });
  });
});

describe("what the owner sets", () => {
  it("accepts https review links and refuses anything else", async () => {
    await expect(setFeedbackSettings(a.owner, { enabled: true, googleReviewUrl: "javascript:alert(1)" })).rejects.toThrow("https");
    await expect(setFeedbackSettings(a.owner, { enabled: true, googleReviewUrl: "http://example.com" })).rejects.toThrow("https");
    await expect(setFeedbackSettings(a.owner, { enabled: true, googleReviewUrl: "nonsense" })).rejects.toThrow("web address");
    await setFeedbackSettings(a.manager, { enabled: true, googleReviewUrl: "https://example.com/review" });
    expect((await getFeedbackSettings(a.owner)).googleReviewUrl).toBe("https://example.com/review");
    await setFeedbackSettings(a.owner, { enabled: true, googleReviewUrl: "" });
    await expect(setFeedbackSettings(a.cashier, { enabled: true, googleReviewUrl: "" })).rejects.toThrow("permission");
  });
});

describe("staff handling low ratings", () => {
  let lowId: string;

  it("summarises recent feedback, and keeps businesses apart", async () => {
    const hi = await visit(a);
    await submitRating(hi.claims, 5);
    const lo = await visit(a);
    await submitRating(lo.claims, 1);
    await submitComment(lo.claims, "Waited 40 minutes");
    lowId = (await db.feedback.findFirstOrThrow({ where: { invoiceId: lo.invoiceId! } })).id;

    const list = await listFeedback(a.manager);
    expect(list.summary.count).toBeGreaterThanOrEqual(2);
    expect(list.items.find((i) => i.id === lowId)).toMatchObject({ rating: 1, comment: "Waited 40 minutes" });
    expect(list.items.find((i) => i.id === lowId)?.invoice.order.table?.label).toBeTruthy();
    // no customer identity travels with feedback
    expect(JSON.stringify(list.items[0])).not.toMatch(/phone|customer/i);

    const other = await listFeedback(b.owner);
    expect(other.summary.count).toBe(0);
    expect(await unresolvedCount(b.owner)).toBe(0);
  });

  it("limits who can see feedback", async () => {
    await expect(listFeedback(a.cashier)).rejects.toThrow("permission");
    await expect(listFeedback(a.waiter)).rejects.toThrow("permission");
    expect(await unresolvedCount(a.cashier)).toBe(0);
    expect(await unresolvedCount(a.manager)).toBeGreaterThan(0);
  });

  it("counts only unhandled low ratings, and a note closes one exactly once", async () => {
    const before = await unresolvedCount(a.manager);
    await expect(resolveFeedback(a.manager, lowId, " ")).rejects.toThrow("what was done");
    await expect(resolveFeedback(b.owner, lowId, "not mine")).rejects.toThrow("not found");
    await resolveFeedback(a.manager, lowId, "Called the guest and offered a free dessert");
    expect(await unresolvedCount(a.manager)).toBe(before - 1);
    await expect(resolveFeedback(a.owner, lowId, "again")).rejects.toThrow("already handled");
    const row = await db.feedback.findUniqueOrThrow({ where: { id: lowId } });
    expect(row).toMatchObject({ handledNote: "Called the guest and offered a free dessert", handledById: a.manager.userId });
    expect(row.handledAt).not.toBeNull();
    await expect(resolveFeedback(a.cashier, lowId, "I will")).rejects.toThrow("permission");
  });

  it("does not count high ratings as needing attention", async () => {
    const before = await unresolvedCount(a.manager);
    const v = await visit(a);
    await submitRating(v.claims, 5);
    expect(await unresolvedCount(a.manager)).toBe(before);
    const v2 = await visit(a);
    await submitRating(v2.claims, 3);
    expect(await unresolvedCount(a.manager)).toBe(before + 1);
  });
});

describe("rating dishes", () => {
  it("lists the dishes on the paid bill and takes one rating per dish, updating on a repeat", async () => {
    const v = await visit(a);
    const state = await getDishRatingState(v.claims);
    expect(state?.canSubmit).toBe(true);
    expect(state?.dishes).toEqual([{ menuItemId: a.momo, name: "Momo", rating: null }]);
    await submitDishRating(v.claims, a.momo, 4);
    await submitDishRating(v.claims, a.momo, 5);
    expect(await db.dishRating.findMany({ where: { invoiceId: v.invoiceId! } })).toHaveLength(1);
    expect((await getDishRatingState(v.claims))?.dishes[0]).toMatchObject({ rating: 5 });
  });

  it("refuses before payment, bad stars, and dishes that were not on the bill (or belong to another business)", async () => {
    const unpaid = await visit(a, { pay: false });
    expect(await getDishRatingState(unpaid.claims)).toBeNull();
    await expect(submitDishRating(unpaid.claims, a.momo, 5)).rejects.toThrow("has been paid");
    const v = await visit(a);
    for (const bad of [0, 6, 2.5, "5", null]) await expect(submitDishRating(v.claims, a.momo, bad)).rejects.toThrow("one and five");
    const cat = await db.menuCategory.findFirstOrThrow({ where: { businessId: a.owner.businessId } });
    const other = await db.menuItem.create({ data: { businessId: a.owner.businessId, categoryId: cat.id, name: "Not ordered", price: 1_000 } });
    await expect(submitDishRating(v.claims, other.id, 5)).rejects.toThrow("not on your bill");
    await expect(submitDishRating(v.claims, b.momo, 5)).rejects.toThrow("not on your bill");
    await expect(submitDishRating(null, a.momo, 5)).rejects.toThrow("has been paid");
  });

  it("closes a day after payment", async () => {
    const v = await visit(a);
    await db.tableSession.update({ where: { id: v.claims.sessionId }, data: { closedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    await expect(submitDishRating(v.claims, a.momo, 5)).rejects.toThrow("closed");
    expect((await getDishRatingState(v.claims))?.canSubmit).toBe(false);
  });

  it("shows a dish's stars to guests only after enough guests rated it, and only its own business's ratings", async () => {
    const cat = await db.menuCategory.findFirstOrThrow({ where: { businessId: a.owner.businessId } });
    const dish = await db.menuItem.create({ data: { businessId: a.owner.businessId, categoryId: cat.id, name: "Rated dish", price: 5_000 } });
    const rateOnce = async (stars: number, w: World = a, dishId: string = dish.id) => {
      const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.owner.branchId, areaId: w.areaId, label: `R${uid()}` } });
      const claims = await openSession(table.publicToken);
      const order = await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
      await addItem(w.owner, order.id, { menuItemId: dishId, quantity: 1 });
      const t = await previewBill(w.owner, order.id, { kind: "none" });
      await checkout(w.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
      await submitDishRating({ sessionId: claims.sessionId, tableId: claims.tableId }, dishId, stars);
    };
    await rateOnce(5);
    await rateOnce(4);
    expect(await dishRatingsFor(a.owner.businessId, [dish.id])).toEqual({}); // only two so far
    await rateOnce(4);
    expect(await dishRatingsFor(a.owner.businessId, [dish.id])).toEqual({ [dish.id]: { average: 4.3, count: 3 } });
    expect(await dishRatingsFor(b.owner.businessId, [dish.id])).toEqual({}); // another business never sees them
    expect(await dishRatingsFor(a.owner.businessId, [])).toEqual({});
  });
});

describe("staff view of dish ratings", () => {
  it("lists rated dishes lowest first with counts, only for people who see feedback, and only this business's", async () => {
    const w = await makeWorld("itest-fb-dishes");
    const cat = await db.menuCategory.findFirstOrThrow({ where: { businessId: w.owner.businessId } });
    const tea = await db.menuItem.create({ data: { businessId: w.owner.businessId, categoryId: cat.id, name: "Tea", price: 5_000 } });
    const rate = async (dishId: string, stars: number) => {
      const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.owner.branchId, areaId: w.areaId, label: `D${uid()}` } });
      const claims = await openSession(table.publicToken);
      const order = await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
      await addItem(w.owner, order.id, { menuItemId: dishId, quantity: 1 });
      const t = await previewBill(w.owner, order.id, { kind: "none" });
      await checkout(w.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
      await submitDishRating({ sessionId: claims.sessionId, tableId: claims.tableId }, dishId, stars);
    };
    for (const stars of [2, 3, 3, 2]) await rate(w.momo, stars); // average 2.5
    for (const stars of [5, 4, 5]) await rate(tea.id, stars); // average 4.7
    await rate(tea.id, 5);

    const { lines } = await listDishRatings(w.manager);
    expect(lines.map((l) => [l.name, l.average, l.count])).toEqual([["Momo", 2.5, 4], ["Tea", 4.8, 4]]);
    expect(lines[0]).toMatchObject({ weak: true, few: false, distribution: [0, 2, 2, 0, 0] });
    await expect(listDishRatings(w.waiter)).rejects.toThrow(/permission/);
    expect((await listDishRatings(b.owner)).lines).toEqual([]); // another business sees none of it

    // a dish removed from the menu keeps its past ratings, shown by a plain name
    await db.dishRating.updateMany({ where: { menuItemId: tea.id }, data: { menuItemId: "gone-dish-id-12345" } });
    expect((await listDishRatings(w.owner)).lines.map((l) => l.name)).toContain("Removed dish");
    // only the chosen period counts
    await db.dishRating.updateMany({ where: { businessId: w.owner.businessId }, data: { createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } });
    expect((await listDishRatings(w.owner, 30)).lines).toEqual([]);
    expect((await listDishRatings(w.owner, 90)).lines).toHaveLength(2);
  });
});
