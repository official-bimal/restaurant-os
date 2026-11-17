import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { subscribeLive, type LiveEvent } from "@/server/live";
import { addItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { refundInvoice } from "@/features/orders/server/void";
import { setBranchMenuItem } from "@/features/menu/server/branch-menu";
import { getCreditNote, getKitchenSlip, getReceipt } from "./server/documents";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  owner: TenantContext;
  cashier: TenantContext;
  waiter: TenantContext;
  kitchen: TenantContext;
  rider: TenantContext;
  branchId: string;
  areaId: string;
  tea: string;
  momo: string;
  grill: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, cashier, waiter, kitchen, rider] = await Promise.all(["owner", "cash", "wait", "kit", "rid"].map(mk));
  const biz = await db.business.create({ data: { name, panNumber: "123456789", memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main", address: "Lakeside" } });
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const bar = await db.station.create({ data: { businessId: biz.id, name: "Bar" } });
  const grill = await db.station.create({ data: { businessId: biz.id, name: "Grill" } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000, stationId: bar.id } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 20_000 } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" },
    cashier: { ...base, userId: cashier.id, role: "CASHIER" },
    waiter: { ...base, userId: waiter.id, role: "WAITER" },
    kitchen: { ...base, userId: kitchen.id, role: "KITCHEN" },
    rider: { ...base, userId: rider.id, role: "RIDER" },
    branchId: branch.id,
    areaId: area.id,
    tea: tea.id,
    momo: momo.id,
    grill: grill.id,
  };
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-print-a");
  b = await makeWorld("itest-print-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.branchMenuItem.deleteMany({ where: { businessId: id } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.refundPayment.deleteMany({ where: { businessId: id } });
    await db.creditNote.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

async function paidOrder(w: World) {
  const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.branchId, areaId: w.areaId, label: `T${uid()}` } });
  const order = await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
  await addItem(w.owner, order.id, { menuItemId: w.tea, quantity: 2, note: "no sugar" });
  await addItem(w.owner, order.id, { menuItemId: w.momo, quantity: 1 });
  const t = await previewBill(w.owner, order.id, { kind: "none" });
  const inv = await checkout(w.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
  return { order, inv, table };
}

describe("printed documents", () => {
  it("builds a receipt with the lines, totals, payments and the business's details, and audits the print", async () => {
    const { inv, order, table } = await paidOrder(a);
    const r = await getReceipt(a.cashier, inv.id);
    expect(r).toMatchObject({ business: "itest-print-a", pan: "123456789", branch: "Main", address: "Lakeside", orderNumber: order.number, where: table.label });
    expect(r.lines.map((l) => [l.name, l.quantity, l.total])).toEqual([["Tea", 2, 16_000], ["Momo", 1, 20_000]]);
    expect(r.lines[0]!.note).toBe("no sugar");
    expect(r.invoice.grandTotal).toBe(inv.grandTotal);
    expect(r.refunded).toBe(0);
    expect(await db.auditEvent.count({ where: { businessId: a.owner.businessId, action: "print.receipt", entityId: inv.id } })).toBe(1);
  });

  it("shows refunds on the receipt and prints each credit note", async () => {
    const { inv } = await paidOrder(a);
    const note = await refundInvoice(a.owner, inv.id, "cold food", { amount: 5_000 });
    expect((await getReceipt(a.owner, inv.id)).refunded).toBe(5_000);
    const c = await getCreditNote(a.owner, note.id);
    expect(c.note).toMatchObject({ number: note.number, grandTotal: 5_000, partial: true, reason: "cold food" });
    expect(c.note.invoice.number).toBe(inv.number);
    expect(c.note.refunds.reduce((s, x) => s + x.amount, 0)).toBe(5_000);
  });

  it("keeps documents to people who may see bills, and to their own business", async () => {
    const { inv } = await paidOrder(a);
    await expect(getReceipt(a.waiter, inv.id)).rejects.toThrow(/permission/);
    await expect(getReceipt(a.kitchen, inv.id)).rejects.toThrow(/permission/);
    await expect(getReceipt(a.rider, inv.id)).rejects.toThrow(/permission/);
    await expect(getReceipt(b.owner, inv.id)).rejects.toThrow(/Invoice not found/);
    const note = await refundInvoice(a.owner, inv.id, "wrong order");
    await expect(getCreditNote(b.owner, note.id)).rejects.toThrow(/not found/);
    await expect(getCreditNote(a.waiter, note.id)).rejects.toThrow(/permission/);
  });

  it("builds a kitchen ticket grouped by station, following a branch's own station choice, without cancelled items", async () => {
    const table = await db.diningTable.create({ data: { businessId: a.owner.businessId, branchId: a.branchId, areaId: a.areaId, label: `K${uid()}` } });
    const order = await createOrder(a.waiter, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
    await addItem(a.waiter, order.id, { menuItemId: a.tea, quantity: 1 });
    await addItem(a.waiter, order.id, { menuItemId: a.momo, quantity: 3, note: "spicy" });
    const gone = await addItem(a.waiter, order.id, { menuItemId: a.momo, quantity: 9 });
    await db.orderItem.update({ where: { id: (gone as { id: string }).id ?? (await db.orderItem.findFirstOrThrow({ where: { orderId: order.id, quantity: 9 } })).id }, data: { status: "CANCELLED" } });
    let s = await getKitchenSlip(a.kitchen, order.id);
    expect(s.table).toBe(table.label);
    expect(s.groups.map((g) => [g.station, g.items.map((i) => [i.name, i.quantity])])).toEqual([["Bar", [["Tea", 1]]], ["Other", [["Momo", 3]]]]);
    expect(s.groups[1]!.items[0]!.note).toBe("spicy");
    // this branch sends momo to the grill
    await setBranchMenuItem(a.owner, a.momo, { price: null, available: true, stationId: a.grill });
    s = await getKitchenSlip(a.waiter, order.id);
    expect(s.groups.map((g) => g.station)).toEqual(["Bar", "Grill"]);
    await expect(getKitchenSlip(a.rider, order.id)).rejects.toThrow(/permission/);
    await expect(getKitchenSlip(b.owner, order.id)).rejects.toThrow(/not found/);
  });
});

describe("live updates", () => {
  it("tells listeners about a change in their own business only", async () => {
    const seenA: LiveEvent[] = [];
    const seenB: LiveEvent[] = [];
    const offA = subscribeLive((e) => e.businessId === a.owner.businessId && seenA.push(e));
    const offB = subscribeLive((e) => e.businessId === b.owner.businessId && seenB.push(e));
    try {
      const table = await db.diningTable.create({ data: { businessId: a.owner.businessId, branchId: a.branchId, areaId: a.areaId, label: `L${uid()}` } });
      await createOrder(a.waiter, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
      await new Promise((r) => setTimeout(r, 400));
      expect(seenA.some((e) => e.topic === "order.create" && e.branchId === a.branchId)).toBe(true);
      expect(seenB).toHaveLength(0);
    } finally {
      offA();
      offB();
    }
  });
});
