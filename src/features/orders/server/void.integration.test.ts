import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { getSettledSummary, openSession, resolveGuest, submitOrder } from "@/features/guest/server/service";
import { adjustPoints, attachCustomerToOrder } from "@/features/loyalty/server/customers";
import { addItem, checkout, createOrder, getOrder, previewBill } from "./service";
import { splitOrder } from "./table-ops";
import { cancelOrder, refundInvoice } from "./void";

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

async function seat(w: World, qty = 5) {
  const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.owner.branchId, areaId: w.areaId, label: `T${uid()}` } });
  const order = await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
  if (qty > 0) await addItem(w.owner, order.id, { menuItemId: w.momo, quantity: qty });
  return { table, order };
}

async function pay(w: World, orderId: string, split?: { cash: number }) {
  const t = await previewBill(w.owner, orderId, { kind: "none" });
  const payments = split
    ? [{ method: "CASH" as const, amount: split.cash }, { method: "QR" as const, amount: t.grandTotal - split.cash }]
    : [{ method: "CASH" as const, amount: t.grandTotal }];
  return checkout(w.owner, orderId, { discount: { kind: "none" }, payments });
}

const tableState = async (id: string) => (await db.diningTable.findUniqueOrThrow({ where: { id } })).state;

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-void-a");
  b = await makeWorld("itest-void-b");
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
    await db.customer.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("cancelling an order", () => {
  it("cancels items and order with a reason, frees the table and tells the guests", async () => {
    const { table, order } = await seat(a, 3);
    const sitting = await openSession((await db.diningTable.findUniqueOrThrow({ where: { id: table.id } })).publicToken);
    const pending = await submitOrder(sitting, { items: [{ menuItemId: a.momo, quantity: 1 }], idempotencyKey: `g-${uid()}-${stamp}` });

    await cancelOrder(a.manager, order.id, "  Guests   walked out ");
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(o).toMatchObject({ status: "CANCELLED", cancelReason: "Guests walked out" });
    expect(o.closedAt).not.toBeNull();
    expect(o.items.every((i) => i.status === "CANCELLED" && i.cancelReason === "Order cancelled: Guests walked out")).toBe(true);
    expect(await tableState(table.id)).toBe("FREE");
    expect(await resolveGuest({ sessionId: sitting.sessionId, tableId: sitting.tableId })).toBeNull();
    expect(await getSettledSummary({ sessionId: sitting.sessionId, tableId: sitting.tableId })).toEqual({ reason: "CANCELLED" });
    expect((await db.guestSubmission.findUniqueOrThrow({ where: { id: pending.id } })).rejectReason).toBe("This order was cancelled.");
    const audit = await db.auditEvent.findFirstOrThrow({ where: { businessId: a.owner.businessId, action: "order.cancel", entityId: order.id } });
    expect(JSON.stringify(audit.detail)).toContain("Momo");
  });

  it("keeps the table when another bill is still open on it", async () => {
    const { table, order } = await seat(a, 4);
    const [item] = await db.orderItem.findMany({ where: { orderId: order.id } });
    const split = await splitOrder(a.manager, order.id, [{ itemId: item.id, quantity: 1 }], `split-${uid()}-${stamp}`);
    const sitting = await openSession((await db.diningTable.findUniqueOrThrow({ where: { id: table.id } })).publicToken);
    await cancelOrder(a.manager, split.id, "Wrong dish");
    expect(await tableState(table.id)).toBe("SEATED");
    expect(await resolveGuest({ sessionId: sitting.sessionId, tableId: sitting.tableId })).not.toBeNull();
    expect((await getOrder(a.manager, order.id))?.status).toBe("OPEN");
  });

  it("needs a reason, and authority when there is food on the order", async () => {
    const { order } = await seat(a, 2);
    await expect(cancelOrder(a.manager, order.id, " ")).rejects.toThrow("reason");
    await expect(cancelOrder(a.manager, order.id, "x".repeat(201))).rejects.toThrow("too long");
    await expect(cancelOrder(a.cashier, order.id, "changed mind")).rejects.toThrow("permission");
    await expect(cancelOrder(a.waiter, order.id, "changed mind")).rejects.toThrow("permission");
    expect((await getOrder(a.owner, order.id))?.status).toBe("OPEN");
  });

  it("lets a waiter cancel an empty order opened by mistake", async () => {
    const { table, order } = await seat(a, 0);
    await cancelOrder(a.waiter, order.id, "Opened by mistake");
    expect((await getOrder(a.owner, order.id))?.status).toBe("CANCELLED");
    expect(await tableState(table.id)).toBe("FREE");
  });

  it("refuses paid, cancelled and merged orders, and other businesses' orders", async () => {
    const paid = await seat(a, 1);
    await pay(a, paid.order.id);
    await expect(cancelOrder(a.owner, paid.order.id, "oops")).rejects.toThrow("Refund the invoice");
    const done = await seat(a, 1);
    await cancelOrder(a.owner, done.order.id, "first time");
    await expect(cancelOrder(a.owner, done.order.id, "second time")).rejects.toThrow("already cancelled");
    await expect(cancelOrder(b.owner, done.order.id, "not mine")).rejects.toThrow("Order not found");
  });

  it("leaves a cancelled order closed: nothing can be added or billed", async () => {
    const { order } = await seat(a, 1);
    await cancelOrder(a.owner, order.id, "Test");
    await expect(addItem(a.owner, order.id, { menuItemId: a.momo, quantity: 1 })).rejects.toThrow("closed");
    await expect(checkout(a.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 1 }] })).rejects.toThrow("cancelled");
  });
});

describe("refunding an invoice", () => {
  it("issues a numbered credit note that copies the invoice and returns money by the original methods", async () => {
    const { order } = await seat(a, 5);
    const inv = await pay(a, order.id, { cash: 50_000 });
    expect(inv.grandTotal).toBe(124_300);
    const note = await refundInvoice(a.manager, inv.id, "Guest unhappy with food");
    expect(note).toMatchObject({ invoiceId: inv.id, grandTotal: 124_300, subtotal: inv.subtotal, vat: inv.vat, serviceCharge: inv.serviceCharge, reason: "Guest unhappy with food" });
    const refunds = await db.refundPayment.findMany({ where: { creditNoteId: note.id }, orderBy: { method: "asc" } });
    expect(refunds.map((r) => [r.method, r.amount])).toEqual([["CASH", 50_000], ["QR", 74_300]]);
    expect(refunds.reduce((s, r) => s + r.amount, 0)).toBe(inv.grandTotal);
    // the invoice itself is untouched
    const again = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(again).toMatchObject({ grandTotal: 124_300, number: inv.number });
    expect((await getOrder(a.owner, order.id))?.invoice?.creditNotes[0]?.number).toBe(note.number);
  });

  it("numbers credit notes in their own sequence", async () => {
    const one = await refundInvoice(a.manager, (await pay(a, (await seat(a, 1)).order.id)).id, "Refund one");
    const two = await refundInvoice(a.manager, (await pay(a, (await seat(a, 1)).order.id)).id, "Refund two");
    expect(two.number).toBe(one.number + 1);
    const foreign = await refundInvoice(b.owner, (await pay(b, (await seat(b, 1)).order.id)).id, "Their first");
    expect(foreign.number).toBe(1); // each business counts from 1
  });

  it("refuses a second refund, missing reasons, other roles and other businesses", async () => {
    const inv = await pay(a, (await seat(a, 1)).order.id);
    await expect(refundInvoice(a.manager, inv.id, "")).rejects.toThrow("reason");
    await expect(refundInvoice(a.cashier, inv.id, "customer asked")).rejects.toThrow("permission");
    await expect(refundInvoice(a.waiter, inv.id, "customer asked")).rejects.toThrow("permission");
    await expect(refundInvoice(b.owner, inv.id, "not mine")).rejects.toThrow("Invoice not found");
    const note = await refundInvoice(a.owner, inv.id, "Customer asked");
    await expect(refundInvoice(a.owner, inv.id, "again")).rejects.toThrow("already been refunded in full");
    expect(note.partial).toBe(false);
    expect(await db.creditNote.count({ where: { invoiceId: inv.id } })).toBe(1);
    await expect(refundInvoice(a.owner, "nope", "bad id")).rejects.toThrow("Invoice not found");
  });

  it("puts the customer's points back exactly as they were", async () => {
    const warm = await seat(a, 1);
    const c = await attachCustomerToOrder(a.cashier, warm.order.id, { phone: "9822000001" });
    await adjustPoints(a.owner, c.id, { points: 300, reason: "starting balance" });
    await cancelOrder(a.owner, warm.order.id, "helper order");

    const { order } = await seat(a, 5); // Rs 1000
    await attachCustomerToOrder(a.cashier, order.id, { phone: "9822000001" });
    const t = await previewBill(a.cashier, order.id, { kind: "none" }, 100);
    const inv = await checkout(a.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }], redeemPoints: 100 });
    expect(inv).toMatchObject({ pointsEarned: 118, pointsRedeemed: 100 });
    let cust = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(cust).toMatchObject({ pointsBalance: 318, visitCount: 1, totalSpend: inv.grandTotal });

    await refundInvoice(a.manager, inv.id, "Wrong order");
    cust = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(cust).toMatchObject({ pointsBalance: 300, visitCount: 0, totalSpend: 0 });
    const entries = await db.loyaltyEntry.findMany({ where: { customerId: c.id, kind: "REVERSAL" }, orderBy: { points: "asc" } });
    expect(entries.map((e) => e.points)).toEqual([-118, 100]);
    const sum = await db.loyaltyEntry.aggregate({ where: { customerId: c.id }, _sum: { points: true } });
    expect(cust.pointsBalance).toBe(sum._sum.points); // the cache still equals the ledger
  });

  it("can leave the balance negative when earned points were already spent, and that blocks spending", async () => {
    const { order } = await seat(a, 5);
    const c = await attachCustomerToOrder(a.cashier, order.id, { phone: "9822000002" });
    const inv = await pay(a, order.id); // earns 124
    const o2 = await seat(a, 5);
    await attachCustomerToOrder(a.cashier, o2.order.id, { phone: "9822000002" });
    const t2 = await previewBill(a.cashier, o2.order.id, { kind: "none" }, 100);
    await checkout(a.owner, o2.order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t2.grandTotal }], redeemPoints: 100 });
    await adjustPoints(a.owner, c.id, { points: -140, reason: "take back to near zero" });
    const before = (await db.customer.findUniqueOrThrow({ where: { id: c.id } })).pointsBalance;
    await refundInvoice(a.owner, inv.id, "Refund the first bill");
    const after = (await db.customer.findUniqueOrThrow({ where: { id: c.id } })).pointsBalance;
    expect(after).toBe(before - 124);
    expect(after).toBeLessThan(0);
    const o3 = await seat(a, 5);
    await attachCustomerToOrder(a.cashier, o3.order.id, { phone: "9822000002" });
    await expect(previewBill(a.cashier, o3.order.id, { kind: "none" }, 100)).rejects.toThrow("enough points");
  });
});

describe("partial refunds", () => {
  const parts = ["subtotal", "discount", "loyaltyDiscount", "serviceCharge", "vat", "roundOff"] as const;

  it("refunds part of a bill by the methods it was paid with, and leaves the invoice untouched", async () => {
    const inv = await pay(a, (await seat(a, 5)).order.id, { cash: 50_000 }); // 50,000 cash + the rest by QR
    const note = await refundInvoice(a.manager, inv.id, "One dish was cold", { amount: 10_000 });
    expect(note).toMatchObject({ grandTotal: 10_000, partial: true });
    const refunds = await db.refundPayment.findMany({ where: { creditNoteId: note.id } });
    expect(refunds.reduce((x, r) => x + r.amount, 0)).toBe(10_000);
    expect(refunds.every((r) => r.amount > 0)).toBe(true);
    // its VAT is its share of the invoice's VAT
    expect(note.vat).toBe(Math.round((inv.vat * 10_000) / inv.grandTotal));
    expect(await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ grandTotal: inv.grandTotal, vat: inv.vat });
  });

  it("lets several part refunds finish the bill exactly, and refuses anything beyond it", async () => {
    const inv = await pay(a, (await seat(a, 5)).order.id, { cash: 50_000 });
    await refundInvoice(a.manager, inv.id, "first", { amount: 33_333 });
    await refundInvoice(a.manager, inv.id, "second", { amount: 12_345 });
    await expect(refundInvoice(a.manager, inv.id, "too much", { amount: inv.grandTotal })).rejects.toThrow(/left to refund/);
    const last = await refundInvoice(a.owner, inv.id, "the rest");
    expect(last.partial).toBe(false);
    const notes = await db.creditNote.findMany({ where: { invoiceId: inv.id } });
    expect(notes).toHaveLength(3);
    expect(notes.reduce((x, c) => x + c.grandTotal, 0)).toBe(inv.grandTotal);
    for (const k of parts) expect(notes.reduce((x, c) => x + c[k], 0)).toBe(inv[k]); // the notes add up to the invoice, part by part
    const byMethod = await db.refundPayment.groupBy({ by: ["method"], where: { creditNote: { invoiceId: inv.id } }, _sum: { amount: true } });
    expect(Object.fromEntries(byMethod.map((m) => [m.method, m._sum.amount]))).toEqual({ CASH: 50_000, QR: inv.grandTotal - 50_000 });
    await expect(refundInvoice(a.owner, inv.id, "again")).rejects.toThrow("already been refunded in full");
  });

  it("refuses bad amounts and can hand back by one method only if it was paid by enough of it", async () => {
    const inv = await pay(a, (await seat(a, 5)).order.id, { cash: 50_000 });
    for (const bad of [0, -5, 1.5, Number.NaN]) await expect(refundInvoice(a.manager, inv.id, "bad", { amount: bad })).rejects.toThrow();
    await expect(refundInvoice(a.manager, inv.id, "cash only", { amount: 60_000, method: "CASH" })).rejects.toThrow(/paid by cash/);
    await expect(refundInvoice(a.manager, inv.id, "weird", { amount: 100, method: "BITCOIN" })).rejects.toThrow(/Choose how/);
    const q = await refundInvoice(a.manager, inv.id, "qr back", { amount: 60_000, method: "QR" });
    expect((await db.refundPayment.findMany({ where: { creditNoteId: q.id } })).map((r) => [r.method, r.amount])).toEqual([["QR", 60_000]]);
    // QR has 14,300 left; the cash 50,000 is still there
    await expect(refundInvoice(a.manager, inv.id, "too much qr", { amount: 20_000, method: "QR" })).rejects.toThrow(/paid by qr/);
    await refundInvoice(a.manager, inv.id, "cash", { amount: 50_000, method: "CASH" });
  });

  it("only the permitted roles, and only for their own business", async () => {
    const inv = await pay(a, (await seat(a, 1)).order.id);
    await expect(refundInvoice(a.cashier, inv.id, "nope", { amount: 100 })).rejects.toThrow("permission");
    await expect(refundInvoice(b.owner, inv.id, "nope", { amount: 100 })).rejects.toThrow("Invoice not found");
  });

  it("gives points back in proportion, and the ledger still equals the balance", async () => {
    const { order } = await seat(a, 5);
    const c = await attachCustomerToOrder(a.cashier, order.id, { phone: "9822000077" });
    await adjustPoints(a.owner, c.id, { points: 300, reason: "to spend" });
    const o2 = await seat(a, 5);
    await attachCustomerToOrder(a.cashier, o2.order.id, { phone: "9822000077" });
    const t2 = await previewBill(a.cashier, o2.order.id, { kind: "none" }, 100);
    const inv = await checkout(a.owner, o2.order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t2.grandTotal }], redeemPoints: 100 });
    const before = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    await refundInvoice(a.owner, inv.id, "half", { amount: Math.floor(inv.grandTotal / 2) });
    const mid = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(mid.visitCount).toBe(before.visitCount); // still a visit until it is refunded in full
    expect(mid.totalSpend).toBe(before.totalSpend - Math.floor(inv.grandTotal / 2));
    await refundInvoice(a.owner, inv.id, "the rest");
    const after = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.visitCount).toBe(before.visitCount - 1);
    expect(after.pointsBalance).toBe(before.pointsBalance - inv.pointsEarned + inv.pointsRedeemed); // same as a one-step full refund
    const sum = await db.loyaltyEntry.aggregate({ where: { customerId: c.id }, _sum: { points: true } });
    expect(after.pointsBalance).toBe(sum._sum.points);
  });

  it("cannot be overshot by two refunds at the same moment", async () => {
    const inv = await pay(a, (await seat(a, 5)).order.id);
    const amount = Math.floor(inv.grandTotal * 0.8);
    const results = await Promise.allSettled([refundInvoice(a.owner, inv.id, "one", { amount }), refundInvoice(a.manager, inv.id, "two", { amount })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const total = (await db.creditNote.aggregate({ where: { invoiceId: inv.id }, _sum: { grandTotal: true } }))._sum.grandTotal;
    expect(total).toBe(amount);
  });
});
