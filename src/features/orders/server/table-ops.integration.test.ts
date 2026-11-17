import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { acceptSubmission, getGuestView, getSettledSummary, openSession, requestService, resolveGuest, submitOrder } from "@/features/guest/server/service";
import { attachCustomerToOrder } from "@/features/loyalty/server/customers";
import { addItem, checkout, createOrder, getOrder, previewBill, setItemStatus } from "./service";
import { listRestructureOptions, mergeOrders, moveToTable, splitOrder } from "./table-ops";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;

interface World {
  owner: TenantContext;
  cashier: TenantContext;
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
    cashier: { ...base, role: "CASHIER" },
    waiter: { ...base, role: "WAITER" },
    areaId: area.id,
    momo: momo.id,
    tea: tea.id,
  };
}

const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

async function newTable(w: World) {
  return db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.owner.branchId, areaId: w.areaId, label: `T${uid()}` } });
}

/** A dine-in order on a fresh table with the given items. */
async function seat(w: World, items: { id: string; qty: number }[]) {
  const table = await newTable(w);
  const order = await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
  for (const i of items) await addItem(w.owner, order.id, { menuItemId: i.id, quantity: i.qty });
  return { table, order };
}

const itemsOf = (orderId: string) => db.orderItem.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
const tableState = async (id: string) => (await db.diningTable.findUniqueOrThrow({ where: { id } })).state;
const units = async (orderIds: string[]) =>
  (await db.orderItem.findMany({ where: { orderId: { in: orderIds }, status: { not: "CANCELLED" } } })).reduce((s, i) => s + i.quantity * i.unitPrice, 0);

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-split-a");
  b = await makeWorld("itest-split-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
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

describe("splitting a bill", () => {
  it("moves a whole line and part of a line, keeping price, note, flags and kitchen progress", async () => {
    const { table, order } = await seat(a, [{ id: a.momo, qty: 5 }, { id: a.tea, qty: 2 }]);
    const [momo, tea] = await itemsOf(order.id);
    await db.orderItem.update({ where: { id: momo.id }, data: { note: "no onion", status: "PREPARING" } });

    const created = await splitOrder(a.cashier, order.id, [{ itemId: momo.id, quantity: 2 }, { itemId: tea.id, quantity: 2 }], `split-${uid()}-${stamp}`);
    expect(created).toMatchObject({ tableId: table.id, splitFromId: order.id, type: "DINE_IN" });
    expect(created.number).toBeGreaterThan(order.number);

    const orig = await itemsOf(order.id);
    const split = await itemsOf(created.id);
    expect(orig.map((i) => [i.name, i.quantity])).toEqual([["Momo", 3]]);
    expect(split.map((i) => [i.name, i.quantity]).sort()).toEqual([["Momo", 2], ["Tea", 2]]);
    const splitMomo = split.find((i) => i.name === "Momo")!;
    expect(splitMomo).toMatchObject({ unitPrice: 20_000, note: "no onion", status: "PREPARING" });
    expect(await units([order.id, created.id])).toBe(5 * 20_000 + 2 * 8_000); // nothing created or lost
  });

  it("re-derives each bill's status from its own items", async () => {
    const { order } = await seat(a, [{ id: a.momo, qty: 1 }, { id: a.tea, qty: 1 }]);
    const [momo, tea] = await itemsOf(order.id);
    for (const it of [momo, tea]) {
      await setItemStatus(a.owner, it.id, "READY");
      await setItemStatus(a.owner, it.id, "SERVED");
    }
    expect((await getOrder(a.owner, order.id))?.status).toBe("SERVED");
    const created = await splitOrder(a.owner, order.id, [{ itemId: tea.id, quantity: 1 }], `split-${uid()}-${stamp}`);
    expect((await getOrder(a.owner, order.id))?.status).toBe("SERVED");
    expect((await getOrder(a.owner, created.id))?.status).toBe("SERVED");
    await addItem(a.owner, created.id, { menuItemId: a.momo, quantity: 1 }); // new pending item
    expect((await getOrder(a.owner, created.id))?.status).toBe("OPEN");
    expect((await getOrder(a.owner, order.id))?.status).toBe("SERVED"); // unaffected
  });

  it("refuses bad selections", async () => {
    const { order } = await seat(a, [{ id: a.momo, qty: 2 }, { id: a.tea, qty: 1 }]);
    const [momo, tea] = await itemsOf(order.id);
    const split = (sel: { itemId: string; quantity: number }[]) => splitOrder(a.owner, order.id, sel, `split-${uid()}-${stamp}`);
    await expect(split([])).rejects.toThrow("at least one");
    await expect(split([{ itemId: momo.id, quantity: 0 }])).rejects.toThrow("at least one");
    await expect(split([{ itemId: momo.id, quantity: 3 }])).rejects.toThrow("between 1 and 2");
    await expect(split([{ itemId: momo.id, quantity: 1.5 }])).rejects.toThrow("between 1 and");
    await expect(split([{ itemId: momo.id, quantity: 2 }, { itemId: tea.id, quantity: 1 }])).rejects.toThrow("Leave at least one");
    await expect(split([{ itemId: momo.id, quantity: 1 }, { itemId: momo.id, quantity: 1 }])).rejects.toThrow("went wrong");
    await expect(split([{ itemId: "nope", quantity: 1 }])).rejects.toThrow("not on this bill");
    await db.orderItem.update({ where: { id: tea.id }, data: { status: "CANCELLED" } });
    await expect(split([{ itemId: tea.id, quantity: 1 }])).rejects.toThrow("not on this bill"); // cancelled items cannot move
    expect(await itemsOf(order.id)).toHaveLength(2); // nothing changed
  });

  it("is safe to repeat: the same key gives the same new bill, not a second split", async () => {
    const { table, order } = await seat(a, [{ id: a.momo, qty: 4 }]);
    const [momo] = await itemsOf(order.id);
    const key = `split-repeat-${uid()}-${stamp}`;
    const one = await splitOrder(a.owner, order.id, [{ itemId: momo.id, quantity: 1 }], key);
    const two = await splitOrder(a.owner, order.id, [{ itemId: momo.id, quantity: 1 }], key);
    expect(two.id).toBe(one.id);
    expect((await itemsOf(order.id))[0].quantity).toBe(3); // moved once, not twice
    expect(await db.order.count({ where: { tableId: table.id } })).toBe(2);
  });

  it("is limited to roles that may restructure bills, and to this business", async () => {
    const { order } = await seat(a, [{ id: a.momo, qty: 2 }]);
    const [momo] = await itemsOf(order.id);
    await expect(splitOrder(a.waiter, order.id, [{ itemId: momo.id, quantity: 1 }], `split-${uid()}-${stamp}`)).rejects.toThrow("permission");
    await expect(splitOrder(b.owner, order.id, [{ itemId: momo.id, quantity: 1 }], `split-${uid()}-${stamp}`)).rejects.toThrow("Order not found");
    expect(await itemsOf(order.id)).toHaveLength(1);
  });

  it("cannot split a paid bill", async () => {
    const { order } = await seat(a, [{ id: a.momo, qty: 2 }]);
    const [momo] = await itemsOf(order.id);
    const t = await previewBill(a.owner, order.id, { kind: "none" });
    await checkout(a.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    await expect(splitOrder(a.owner, order.id, [{ itemId: momo.id, quantity: 1 }], `split-${uid()}-${stamp}`)).rejects.toThrow("already paid");
  });
});

describe("paying split bills", () => {
  it("keeps the table and the guests' sitting until the last bill is paid", async () => {
    const { table, order } = await seat(a, [{ id: a.momo, qty: 4 }]);
    const [momo] = await itemsOf(order.id);
    const sitting = await openSession((await db.diningTable.findUniqueOrThrow({ where: { id: table.id } })).publicToken);
    const split = await splitOrder(a.cashier, order.id, [{ itemId: momo.id, quantity: 2 }], `split-${uid()}-${stamp}`);

    const p1 = await previewBill(a.cashier, order.id, { kind: "none" });
    const inv1 = await checkout(a.cashier, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: p1.grandTotal }] });
    expect(await tableState(table.id)).toBe("SEATED"); // the other bill is still open
    expect(await resolveGuest({ sessionId: sitting.sessionId, tableId: sitting.tableId })).not.toBeNull();

    const p2 = await previewBill(a.cashier, split.id, { kind: "none" });
    const inv2 = await checkout(a.cashier, split.id, { discount: { kind: "none" }, payments: [{ method: "QR", amount: p2.grandTotal }] });
    expect(inv2.number).toBe(inv1.number + 1);
    expect(await tableState(table.id)).toBe("FREE");
    expect(await resolveGuest({ sessionId: sitting.sessionId, tableId: sitting.tableId })).toBeNull();
    const ended = await getSettledSummary({ sessionId: sitting.sessionId, tableId: sitting.tableId });
    expect(ended?.reason).toBe("PAID");
  });

  it("gives each bill its own invoice and its own customer points", async () => {
    const { order } = await seat(a, [{ id: a.momo, qty: 5 }]);
    const [momo] = await itemsOf(order.id);
    const split = await splitOrder(a.cashier, order.id, [{ itemId: momo.id, quantity: 2 }], `split-${uid()}-${stamp}`);
    const c1 = await attachCustomerToOrder(a.cashier, order.id, { phone: "9811000001" });
    const c2 = await attachCustomerToOrder(a.cashier, split.id, { phone: "9811000002" });
    for (const id of [order.id, split.id]) {
      const t = await previewBill(a.cashier, id, { kind: "none" });
      await checkout(a.cashier, id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    }
    const [x, y] = await Promise.all([c1, c2].map((c) => db.customer.findUniqueOrThrow({ where: { id: c.id } })));
    expect(x.totalSpend + y.totalSpend).toBeGreaterThan(0);
    expect(x.pointsBalance).toBeGreaterThan(y.pointsBalance); // 3 momo earn more than 2
    expect([x.visitCount, y.visitCount]).toEqual([1, 1]);
  });

  it("shows the guests one party: all items, each bill, and the total of the bills", async () => {
    const { table, order } = await seat(a, [{ id: a.momo, qty: 3 }, { id: a.tea, qty: 1 }]);
    const [momo] = await itemsOf(order.id);
    const split = await splitOrder(a.cashier, order.id, [{ itemId: momo.id, quantity: 1 }], `split-${uid()}-${stamp}`);
    const gc = await openSession((await db.diningTable.findUniqueOrThrow({ where: { id: table.id } })).publicToken);
    const view = await getGuestView(gc);
    expect(view.orderItems).toHaveLength(3); // momo(2), tea, momo(1)
    expect(view.bills.map((x) => x.number)).toEqual([order.number, split.number]);
    const staff = [await previewBill(a.cashier, order.id, { kind: "none" }), await previewBill(a.cashier, split.id, { kind: "none" })];
    expect(view.bills.map((x) => x.total)).toEqual(staff.map((s) => s.grandTotal));
    expect(view.estimate?.grandTotal).toBe(staff[0].grandTotal + staff[1].grandTotal);
  });

  it("sends a guest's new order to the first bill", async () => {
    const { table, order } = await seat(a, [{ id: a.momo, qty: 2 }]);
    const [momo] = await itemsOf(order.id);
    const split = await splitOrder(a.cashier, order.id, [{ itemId: momo.id, quantity: 1 }], `split-${uid()}-${stamp}`);
    const gc = await openSession((await db.diningTable.findUniqueOrThrow({ where: { id: table.id } })).publicToken);
    const sub = await submitOrder(gc, { items: [{ menuItemId: a.tea, quantity: 1 }], idempotencyKey: `guest-split-${uid()}` });
    await acceptSubmission(a.cashier, sub.id);
    expect((await itemsOf(order.id)).map((i) => i.name)).toContain("Tea");
    expect((await itemsOf(split.id)).map((i) => i.name)).not.toContain("Tea");
  });
});

describe("moving to another table", () => {
  it("moves the party: bill, table states, and ends the old table's guest sitting with the right reason", async () => {
    const { table, order } = await seat(a, [{ id: a.momo, qty: 2 }]);
    const target = await newTable(a);
    const gc = await openSession((await db.diningTable.findUniqueOrThrow({ where: { id: table.id } })).publicToken);
    const pending = await submitOrder(gc, { items: [{ menuItemId: a.tea, quantity: 1 }], idempotencyKey: `guest-move-${uid()}` });
    await requestService(gc, "REQUEST_BILL"); // table becomes BILL_REQUESTED

    await moveToTable(a.cashier, order.id, target.id);
    const moved = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(moved.tableId).toBe(target.id);
    expect(await tableState(table.id)).toBe("FREE");
    expect(await tableState(target.id)).toBe("BILL_REQUESTED"); // the request travels with the party
    expect(await resolveGuest({ sessionId: gc.sessionId, tableId: gc.tableId })).toBeNull();
    expect(await getSettledSummary({ sessionId: gc.sessionId, tableId: gc.tableId })).toEqual({ reason: "MOVED" });
    expect((await db.guestSubmission.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("REJECTED");
    expect(await db.serviceRequest.count({ where: { tableId: table.id, status: "OPEN" } })).toBe(0);
    expect((await db.auditEvent.findMany({ where: { businessId: a.owner.businessId, action: "order.moveTable" } })).length).toBeGreaterThan(0);
  });

  it("moves every bill of a split table together", async () => {
    const { table, order } = await seat(a, [{ id: a.momo, qty: 3 }]);
    const [momo] = await itemsOf(order.id);
    const split = await splitOrder(a.cashier, order.id, [{ itemId: momo.id, quantity: 1 }], `split-${uid()}-${stamp}`);
    const target = await newTable(a);
    await moveToTable(a.cashier, split.id, target.id);
    expect((await db.order.findMany({ where: { id: { in: [order.id, split.id] } } })).map((o) => o.tableId)).toEqual([target.id, target.id]);
    expect(await tableState(table.id)).toBe("FREE");
  });

  it("refuses a busy table, the same table, takeaway, paid bills, another business's table and other roles", async () => {
    const one = await seat(a, [{ id: a.momo, qty: 1 }]);
    const two = await seat(a, [{ id: a.momo, qty: 1 }]);
    await expect(moveToTable(a.cashier, one.order.id, two.table.id)).rejects.toThrow("not free");
    await expect(moveToTable(a.cashier, one.order.id, one.table.id)).rejects.toThrow("already");
    const foreign = await db.diningTable.create({ data: { businessId: b.owner.businessId, branchId: b.owner.branchId, areaId: b.areaId, label: `F${uid()}` } });
    await expect(moveToTable(a.cashier, one.order.id, foreign.id)).rejects.toThrow("Table not found");
    await expect(moveToTable(b.owner, one.order.id, foreign.id)).rejects.toThrow("Order not found");
    const free = await newTable(a);
    await expect(moveToTable(a.waiter, one.order.id, free.id)).rejects.toThrow("permission");
    const take = await createOrder(a.owner, { type: "TAKEAWAY", idempotencyKey: `tk-${uid()}-${stamp}` });
    await expect(moveToTable(a.cashier, take.id, free.id)).rejects.toThrow("Takeaway");
    const t = await previewBill(a.owner, two.order.id, { kind: "none" });
    await checkout(a.owner, two.order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    await expect(moveToTable(a.cashier, two.order.id, free.id)).rejects.toThrow("already paid");
  });

  it("only offers free tables and other open bills as options", async () => {
    const one = await seat(a, [{ id: a.momo, qty: 1 }]);
    const two = await seat(a, [{ id: a.momo, qty: 1 }]);
    const free = await newTable(a);
    const opts = await listRestructureOptions(a.cashier, one.order.id);
    const ids = opts.freeTables.map((t) => t.id);
    expect(ids).toContain(free.id);
    expect(ids).not.toContain(one.table.id);
    expect(ids).not.toContain(two.table.id);
    expect(opts.mergeTargets.map((m) => m.id)).toContain(two.order.id);
    expect(opts.mergeTargets.map((m) => m.id)).not.toContain(one.order.id);
    await expect(listRestructureOptions(b.owner, one.order.id)).rejects.toThrow("Order not found");
  });
});

describe("merging bills", () => {
  it("folds one bill into another: items move, the source is kept as MERGED, its table frees up", async () => {
    const one = await seat(a, [{ id: a.momo, qty: 2 }]);
    const two = await seat(a, [{ id: a.tea, qty: 3 }]);
    const sitting = await openSession((await db.diningTable.findUniqueOrThrow({ where: { id: two.table.id } })).publicToken);
    await requestService(sitting, "REQUEST_BILL");

    await mergeOrders(a.cashier, two.order.id, one.order.id);
    expect((await itemsOf(one.order.id)).map((i) => [i.name, i.quantity]).sort()).toEqual([["Momo", 2], ["Tea", 3]]);
    expect(await itemsOf(two.order.id)).toHaveLength(0);
    const src = await db.order.findUniqueOrThrow({ where: { id: two.order.id } });
    expect(src).toMatchObject({ status: "MERGED", mergedIntoId: one.order.id });
    expect(src.closedAt).not.toBeNull();
    expect(await tableState(two.table.id)).toBe("FREE");
    expect(await tableState(one.table.id)).toBe("BILL_REQUESTED"); // the request travels with the bill
    expect(await getSettledSummary({ sessionId: sitting.sessionId, tableId: sitting.tableId })).toEqual({ reason: "MERGED" });
    expect(await units([one.order.id])).toBe(2 * 20_000 + 3 * 8_000);
  });

  it("re-derives the target's status and brings the customer along when the target has none", async () => {
    const one = await seat(a, [{ id: a.momo, qty: 1 }]);
    const [momo] = await itemsOf(one.order.id);
    await setItemStatus(a.owner, momo.id, "READY");
    await setItemStatus(a.owner, momo.id, "SERVED");
    expect((await getOrder(a.owner, one.order.id))?.status).toBe("SERVED");
    const two = await seat(a, [{ id: a.tea, qty: 1 }]); // pending
    const c = await attachCustomerToOrder(a.cashier, two.order.id, { phone: "9811000009" });

    await mergeOrders(a.cashier, two.order.id, one.order.id);
    const target = await db.order.findUniqueOrThrow({ where: { id: one.order.id } });
    expect(target.status).toBe("OPEN"); // a pending item arrived
    expect(target).toMatchObject({ customerId: c.id, customerConfirmed: true });
    expect((await db.order.findUniqueOrThrow({ where: { id: two.order.id } })).customerId).toBeNull();
  });

  it("is the way back from a split: same table stays occupied", async () => {
    const { table, order } = await seat(a, [{ id: a.momo, qty: 4 }]);
    const [momo] = await itemsOf(order.id);
    const sitting = await openSession((await db.diningTable.findUniqueOrThrow({ where: { id: table.id } })).publicToken);
    const split = await splitOrder(a.cashier, order.id, [{ itemId: momo.id, quantity: 3 }], `split-${uid()}-${stamp}`);
    await mergeOrders(a.cashier, split.id, order.id);
    expect(await units([order.id])).toBe(4 * 20_000);
    expect(await tableState(table.id)).toBe("SEATED");
    expect(await resolveGuest({ sessionId: sitting.sessionId, tableId: sitting.tableId })).not.toBeNull(); // guests undisturbed
  });

  it("refuses merging into itself, closed bills, another business's bill and other roles", async () => {
    const one = await seat(a, [{ id: a.momo, qty: 1 }]);
    const two = await seat(a, [{ id: a.tea, qty: 1 }]);
    const foreign = await seat(b, [{ id: b.momo, qty: 1 }]);
    await expect(mergeOrders(a.cashier, one.order.id, one.order.id)).rejects.toThrow("different bill");
    await expect(mergeOrders(a.cashier, one.order.id, foreign.order.id)).rejects.toThrow("Order not found");
    await expect(mergeOrders(a.cashier, foreign.order.id, one.order.id)).rejects.toThrow("Order not found");
    await expect(mergeOrders(a.waiter, one.order.id, two.order.id)).rejects.toThrow("permission");
    await mergeOrders(a.cashier, two.order.id, one.order.id);
    await expect(mergeOrders(a.cashier, two.order.id, one.order.id)).rejects.toThrow("merged");
    await expect(addItem(a.owner, two.order.id, { menuItemId: a.momo, quantity: 1 })).rejects.toThrow("closed");
    const t = await previewBill(a.owner, one.order.id, { kind: "none" });
    await checkout(a.owner, one.order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    await expect(mergeOrders(a.cashier, one.order.id, two.order.id)).rejects.toThrow(/paid|merged/);
  });

  it("cannot check out a merged bill, and the merged total is billed once", async () => {
    const one = await seat(a, [{ id: a.momo, qty: 1 }]);
    const two = await seat(a, [{ id: a.tea, qty: 1 }]);
    await mergeOrders(a.cashier, two.order.id, one.order.id);
    await expect(checkout(a.owner, two.order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 1 }] })).rejects.toThrow();
    const t = await previewBill(a.owner, one.order.id, { kind: "none" });
    expect(t.subtotal).toBe(20_000 + 8_000);
  });
});
