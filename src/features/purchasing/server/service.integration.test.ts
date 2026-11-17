import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { itemAt } from "@/features/stock/server/test-support";
import type { TenantContext } from "@/server/auth";
import { createStockItem, recordPurchase } from "@/features/stock/server/service";
import {
  archiveSupplier,
  cancelPurchaseOrder,
  closeShort,
  createDraftFromLowStock,
  createPurchaseOrder,
  createSupplier,
  getPurchaseOrder,
  listPurchaseOrders,
  listSuppliers,
  markOrdered,
  receiveDelivery,
  suggestedLines,
  updateDraft,
  updateSupplier,
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
}

async function makeWorld(name: string): Promise<World> {
  const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main branch" } });
  businessIds.push(biz.id);
  const base = { userId: user.id, businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, role: "OWNER" },
    manager: { ...base, role: "MANAGER" },
    cashier: { ...base, role: "CASHIER" },
    kitchen: { ...base, role: "KITCHEN" },
    waiter: { ...base, role: "WAITER" },
  };
}

const item = (id: string) => itemAt(id);
const lineOf = (poId: string, stockItemId: string) => db.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: poId, stockItemId } });

let a: World;
let b: World;
let supplier: string;
let flour: string;
let milk: string;

beforeAll(async () => {
  a = await makeWorld("itest-po-a");
  b = await makeWorld("itest-po-b");
  supplier = (await createSupplier(a.manager, { name: "Pokhara Mill", phone: "9811000555" })).id;
  flour = (await createStockItem(a.owner, { name: "Flour", unit: "g", reorderLevel: 1000 })).id;
  milk = (await createStockItem(a.owner, { name: "Milk", unit: "ml", reorderLevel: 2000 })).id;
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.purchaseOrderLine.deleteMany({ where: { businessId: id } });
    await db.purchaseOrder.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("suppliers", () => {
  it("creates suppliers with a cleaned name and a normalised phone, refusing duplicates in any case", async () => {
    const s = await db.supplier.findUniqueOrThrow({ where: { id: supplier } });
    expect(s).toMatchObject({ name: "Pokhara Mill", phone: "+9779811000555" });
    await expect(createSupplier(a.owner, { name: " pokhara   MILL " })).rejects.toThrow("already exists");
    await expect(createSupplier(a.owner, { name: "Bad Phone", phone: "12" })).rejects.toThrow("valid phone");
    await expect(createSupplier(a.owner, { name: " " })).rejects.toThrow("name");
    await expect(createSupplier(b.owner, { name: "Pokhara Mill" })).resolves.toBeTruthy(); // another business may reuse the name
  });

  it("limits who can change suppliers, and keeps businesses apart", async () => {
    await expect(createSupplier(a.cashier, { name: "X" })).rejects.toThrow("permission");
    await expect(createSupplier(a.kitchen, { name: "X" })).rejects.toThrow("permission");
    await expect(listSuppliers(a.waiter)).rejects.toThrow("permission");
    await expect(listSuppliers(a.kitchen)).resolves.toBeTruthy();
    expect((await listSuppliers(b.owner)).every((s) => s.businessId === b.owner.businessId)).toBe(true);
    await expect(updateSupplier(b.owner, supplier, { name: "Hijack" })).rejects.toThrow("not found");
    await expect(archiveSupplier(b.owner, supplier)).rejects.toThrow("not found");
  });
});

describe("writing an order", () => {
  it("numbers orders in sequence per business and estimates prices from the item's average cost", async () => {
    await recordPurchase(a.manager, { lines: [{ stockItemId: flour, quantity: 1000, totalCost: 80_000 }] }); // Rs 0.80/g
    const po = await createPurchaseOrder(a.manager, { supplierId: supplier, lines: [{ stockItemId: flour, quantity: 5000 }], expectedOn: "2026-11-30", note: "  Deliver   early " });
    expect(po).toMatchObject({ number: 1, status: "DRAFT", expectedOn: "2026-11-30", note: "Deliver early" });
    expect((await lineOf(po.id, flour)).estimatedTotal).toBe(400_000); // 5000 g at 0.80 paisa... Rs 4,000
    const second = await createPurchaseOrder(a.manager, { supplierId: supplier, lines: [{ stockItemId: milk, quantity: 1000, estimatedTotal: 9_000 }] });
    expect(second.number).toBe(2);
    expect((await lineOf(second.id, milk)).estimatedTotal).toBe(9_000);
    const other = await createSupplier(b.owner, { name: "Other" });
    const bItem = await createStockItem(b.owner, { name: "Rice", unit: "g", reorderLevel: 0 });
    expect((await createPurchaseOrder(b.owner, { supplierId: other.id, lines: [{ stockItemId: bItem.id, quantity: 10 }] })).number).toBe(1);
  });

  it("refuses bad orders and other businesses' suppliers or items", async () => {
    const make = (over: Partial<Parameters<typeof createPurchaseOrder>[1]> = {}) =>
      createPurchaseOrder(a.manager, { supplierId: supplier, lines: [{ stockItemId: flour, quantity: 10 }], ...over });
    await expect(make({ lines: [] })).rejects.toThrow("at least one");
    await expect(make({ lines: [{ stockItemId: flour, quantity: 0 }] })).rejects.toThrow("whole numbers");
    await expect(make({ lines: [{ stockItemId: flour, quantity: 1.5 }] })).rejects.toThrow("whole numbers");
    await expect(make({ lines: [{ stockItemId: flour, quantity: 5 }, { stockItemId: flour, quantity: 6 }] })).rejects.toThrow("once");
    await expect(make({ lines: [{ stockItemId: "missing", quantity: 5 }] })).rejects.toThrow("not found");
    await expect(make({ expectedOn: "2026-02-30" })).rejects.toThrow("valid date");
    await expect(make({ note: "x".repeat(301) })).rejects.toThrow("too long");
    await expect(createPurchaseOrder(b.owner, { supplierId: supplier, lines: [{ stockItemId: flour, quantity: 5 }] })).rejects.toThrow("Supplier not found");
    await expect(createPurchaseOrder(a.cashier, { supplierId: supplier, lines: [{ stockItemId: flour, quantity: 5 }] })).rejects.toThrow("permission");
    const bItem = await createStockItem(b.owner, { name: `Beans ${uid()}`, unit: "g", reorderLevel: 0 });
    await expect(make({ lines: [{ stockItemId: bItem.id, quantity: 5 }] })).rejects.toThrow("not found");
  });

  it("can change a draft, but not an order that has been placed", async () => {
    const po = await createPurchaseOrder(a.manager, { supplierId: supplier, lines: [{ stockItemId: flour, quantity: 100 }] });
    await updateDraft(a.manager, po.id, { lines: [{ stockItemId: flour, quantity: 200 }, { stockItemId: milk, quantity: 300 }], note: "Updated" });
    expect((await getPurchaseOrder(a.manager, po.id)).lines.map((l) => [l.stockItem.name, l.quantityOrdered])).toEqual([["Flour", 200], ["Milk", 300]]);
    await markOrdered(a.manager, po.id);
    await expect(updateDraft(a.manager, po.id, { lines: [{ stockItemId: flour, quantity: 1 }] })).rejects.toThrow("Only a draft");
    await expect(updateDraft(b.owner, po.id, { lines: [{ stockItemId: flour, quantity: 1 }] })).rejects.toThrow("not found");
  });

  it("writes the order text a person can send, and cannot archive a supplier with an open order", async () => {
    const po = await createPurchaseOrder(a.manager, { supplierId: supplier, lines: [{ stockItemId: flour, quantity: 5000 }, { stockItemId: milk, quantity: 20000 }], expectedOn: "2026-12-01" });
    const full = await getPurchaseOrder(a.manager, po.id);
    expect(full.text).toContain(`Order #${po.number} from itest-po-a for Pokhara Mill`);
    expect(full.text).toContain("- Flour: 5,000 g");
    expect(full.text).toContain("- Milk: 20,000 ml");
    expect(full.text).toContain("Needed by 2026-12-01");
    await expect(archiveSupplier(a.manager, supplier)).rejects.toThrow("open order");
  });
});

describe("placing and receiving", () => {
  let po: string;

  beforeAll(async () => {
    po = (await createPurchaseOrder(a.manager, { supplierId: supplier, lines: [{ stockItemId: flour, quantity: 1000, estimatedTotal: 90_000 }, { stockItemId: milk, quantity: 500, estimatedTotal: 5_000 }] })).id;
  });

  it("must be placed before anything can be received", async () => {
    const l = await lineOf(po, flour);
    await expect(receiveDelivery(a.manager, po, [{ lineId: l.id, quantity: 10, totalCost: 900 }])).rejects.toThrow("has been placed");
    await markOrdered(a.manager, po);
    await expect(markOrdered(a.manager, po)).rejects.toThrow("Only a draft");
    await expect(markOrdered(b.owner, po)).rejects.toThrow("not found");
  });

  it("books a part delivery into stock at the price paid, blending the average cost", async () => {
    const f0 = await item(flour); // 1000 g at 80_000 milli from the earlier purchase
    const l = await lineOf(po, flour);
    const res = await receiveDelivery(a.manager, po, [{ lineId: l.id, quantity: 600, totalCost: 54_000 }]); // Rs 540 for 600 g = 0.90/g
    expect(res.complete).toBe(false);
    const f1 = await item(flour);
    expect(f1.quantity).toBe(f0.quantity + 600);
    expect(f1.costMilli).toBe(Math.round((f0.quantity * f0.costMilli + 54_000 * 1000) / (f0.quantity + 600)));
    const move = await db.stockMovement.findFirstOrThrow({ where: { stockItemId: flour, note: { startsWith: "PO #" } }, orderBy: { createdAt: "desc" } });
    expect(move).toMatchObject({ kind: "PURCHASE", quantity: 600, totalCost: 54_000, supplier: "Pokhara Mill" });
    expect(await lineOf(po, flour)).toMatchObject({ quantityReceived: 600, paidTotal: 54_000 });
    expect((await getPurchaseOrder(a.manager, po)).status).toBe("ORDERED"); // still waiting for the rest
    expect((await getPurchaseOrder(a.manager, po)).state).toBe("PART");
  });

  it("refuses more than was ordered, nothing arriving, wrong lines and other roles", async () => {
    const l = await lineOf(po, flour);
    await expect(receiveDelivery(a.manager, po, [{ lineId: l.id, quantity: 401, totalCost: 100 }])).rejects.toThrow("Only 400 more");
    await expect(receiveDelivery(a.manager, po, [{ lineId: l.id, quantity: 0, totalCost: 0 }])).rejects.toThrow("at least one");
    await expect(receiveDelivery(a.manager, po, [{ lineId: "nope", quantity: 5, totalCost: 5 }])).rejects.toThrow("not on this order");
    await expect(receiveDelivery(a.manager, po, [{ lineId: l.id, quantity: 5, totalCost: -1 }])).rejects.toThrow("price paid");
    await expect(receiveDelivery(a.manager, po, [{ lineId: l.id, quantity: 5, totalCost: 1.5 }])).rejects.toThrow("price paid");
    await expect(receiveDelivery(a.cashier, po, [{ lineId: l.id, quantity: 5, totalCost: 5 }])).rejects.toThrow("permission");
    await expect(receiveDelivery(b.owner, po, [{ lineId: l.id, quantity: 5, totalCost: 5 }])).rejects.toThrow("not found");
    expect((await lineOf(po, flour)).quantityReceived).toBe(600);
  });

  it("is all or nothing: a bad second line leaves the first line unapplied", async () => {
    const lf = await lineOf(po, flour);
    const lm = await lineOf(po, milk);
    const flourBefore = (await item(flour)).quantity;
    await expect(
      receiveDelivery(a.manager, po, [
        { lineId: lf.id, quantity: 100, totalCost: 9_000 },
        { lineId: lm.id, quantity: 9_999, totalCost: 1 }, // more than ordered
      ]),
    ).rejects.toThrow("Only 500 more");
    expect((await item(flour)).quantity).toBe(flourBefore);
    expect((await lineOf(po, flour)).quantityReceived).toBe(600);
  });

  it("finishes the order when the last of it arrives, and the ledger still adds up", async () => {
    const lf = await lineOf(po, flour);
    const lm = await lineOf(po, milk);
    const res = await receiveDelivery(a.manager, po, [
      { lineId: lf.id, quantity: 400, totalCost: 38_000 },
      { lineId: lm.id, quantity: 500, totalCost: 5_500 },
    ]);
    expect(res.complete).toBe(true);
    const done = await getPurchaseOrder(a.manager, po);
    expect(done).toMatchObject({ status: "RECEIVED", state: "ALL" });
    expect(done.receivedAt).not.toBeNull();
    expect(done.lines.find((l) => l.stockItem.name === "Flour")).toMatchObject({ quantityReceived: 1000, paidTotal: 92_000, estimatedTotal: 90_000 });
    await expect(receiveDelivery(a.manager, po, [{ lineId: lf.id, quantity: 1, totalCost: 1 }])).rejects.toThrow("has been placed");
    for (const id of [flour, milk]) {
      const sum = await db.stockMovement.aggregate({ where: { stockItemId: id }, _sum: { quantity: true } });
      expect((await item(id)).quantity).toBe(sum._sum.quantity);
    }
    expect((await listPurchaseOrders(a.manager)).find((o) => o.id === po)).toMatchObject({ estimatedTotal: 95_000, paidTotal: 97_500 });
  });
});

describe("closing short and cancelling", () => {
  const placed = async () => {
    const po = await createPurchaseOrder(a.manager, { supplierId: supplier, lines: [{ stockItemId: flour, quantity: 1000 }, { stockItemId: milk, quantity: 1000 }] });
    await markOrdered(a.manager, po.id);
    return po.id;
  };

  it("closes a part-delivered order as received, with a reason", async () => {
    const po = await placed();
    await expect(closeShort(a.manager, po, "supplier ran out")).rejects.toThrow("Nothing has arrived");
    const l = await lineOf(po, flour);
    await receiveDelivery(a.manager, po, [{ lineId: l.id, quantity: 300, totalCost: 30_000 }]);
    await expect(closeShort(a.manager, po, " ")).rejects.toThrow("why the rest");
    await closeShort(a.manager, po, "Supplier ran out of milk");
    expect(await getPurchaseOrder(a.manager, po)).toMatchObject({ status: "RECEIVED", closeNote: "Supplier ran out of milk" });
    await expect(cancelPurchaseOrder(a.manager, po, "too late")).rejects.toThrow("already finished");
  });

  it("cancels a draft freely, a placed order with a reason, and refuses once goods have arrived", async () => {
    const draft = await createPurchaseOrder(a.manager, { supplierId: supplier, lines: [{ stockItemId: flour, quantity: 10 }] });
    await cancelPurchaseOrder(a.manager, draft.id, "");
    expect((await getPurchaseOrder(a.manager, draft.id)).status).toBe("CANCELLED");

    const ordered = await placed();
    await expect(cancelPurchaseOrder(a.manager, ordered, " ")).rejects.toThrow("why you are cancelling");
    const l = await lineOf(ordered, flour);
    await receiveDelivery(a.manager, ordered, [{ lineId: l.id, quantity: 1, totalCost: 80 }]);
    await expect(cancelPurchaseOrder(a.manager, ordered, "changed our mind")).rejects.toThrow("Close it as received");

    const untouched = await placed();
    await cancelPurchaseOrder(a.manager, untouched, "Found a cheaper supplier");
    expect(await getPurchaseOrder(a.manager, untouched)).toMatchObject({ status: "CANCELLED", closeNote: "Found a cheaper supplier" });
    await expect(cancelPurchaseOrder(b.owner, untouched, "not mine")).rejects.toThrow("not found");
    await expect(cancelPurchaseOrder(a.cashier, draft.id, "x")).rejects.toThrow("permission");
  });

  it("lets a supplier be archived once its orders are finished", async () => {
    const s = await createSupplier(a.manager, { name: `Temp ${uid()}` });
    const po = await createPurchaseOrder(a.manager, { supplierId: s.id, lines: [{ stockItemId: flour, quantity: 5 }] });
    await expect(archiveSupplier(a.manager, s.id)).rejects.toThrow("open order");
    await cancelPurchaseOrder(a.manager, po.id, "");
    await archiveSupplier(a.manager, s.id);
    expect((await listSuppliers(a.manager)).some((x) => x.id === s.id)).toBe(false);
  });
});

describe("what to reorder", () => {
  it("suggests low items, counts what is already on order, and drafts an order from it", async () => {
    const w = await makeWorld("itest-po-low");
    const sup = await createSupplier(w.owner, { name: "Dairy" });
    const lowMilk = (await createStockItem(w.owner, { name: "Milk", unit: "ml", reorderLevel: 1000 })).id;
    const fine = (await createStockItem(w.owner, { name: "Sugar", unit: "g", reorderLevel: 100 })).id;
    await recordPurchase(w.owner, { lines: [{ stockItemId: fine, quantity: 5000, totalCost: 500 }] });
    await recordPurchase(w.owner, { lines: [{ stockItemId: lowMilk, quantity: 300, totalCost: 900 }] });

    const first = await suggestedLines(w.manager);
    expect(first.map((s) => [s.name, s.quantity])).toEqual([["Milk", 1700]]); // target 2000, have 300
    const po = await createDraftFromLowStock(w.manager, sup.id);
    expect(po.note).toBe("From low stock");
    expect((await lineOf(po.id, lowMilk)).quantityOrdered).toBe(1700);

    await markOrdered(w.manager, po.id);
    expect(await suggestedLines(w.manager)).toEqual([]); // 2000 now on hand + on order
    await expect(createDraftFromLowStock(w.manager, sup.id)).rejects.toThrow("Nothing is low");
    await expect(suggestedLines(w.waiter)).rejects.toThrow("permission");
  });
});
