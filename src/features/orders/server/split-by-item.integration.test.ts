import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addItem, checkout, createOrder, previewBill, setItemStatus } from "./service";
import { splitByItem, splitOrder } from "./table-ops";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}${Math.random().toString(36).slice(2, 8)}`;

async function world(name: string) {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, waiter, cashier] = await Promise.all(["owner", "wait", "cash"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  await db.membership.create({ data: { userId: waiter.id, businessId: biz.id, role: "WAITER" } });
  await db.membership.create({ data: { userId: cashier.id, businessId: biz.id, role: "CASHIER" } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 25_000 } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000 } });
  const pizza = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Pizza", price: 100_000 } });
  const flour = await db.stockItem.create({ data: { businessId: biz.id, name: "Flour", unit: "g" } });
  await db.recipeLine.create({ data: { businessId: biz.id, menuItemId: pizza.id, stockItemId: flour.id, quantity: 300 } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" } as TenantContext,
    waiter: { ...base, userId: waiter.id, role: "WAITER" } as TenantContext,
    cashier: { ...base, userId: cashier.id, role: "CASHIER" } as TenantContext,
    branchId: branch.id,
    areaId: area.id,
    momo: momo.id,
    tea: tea.id,
    pizza: pizza.id,
    flour: flour.id,
  };
}

type W = Awaited<ReturnType<typeof world>>;
let a: W;
let b: W;

async function seat(w: W, items: [string, number][], type: "DINE_IN" | "DELIVERY" = "DINE_IN") {
  const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.branchId, areaId: w.areaId, label: `T${uid()}` } });
  let order = await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
  const ids: string[] = [];
  for (const [menuItemId, quantity] of items) ids.push((await addItem(w.owner, order.id, { menuItemId, quantity })).id);
  // (A real delivery order needs a rider's phone and address; the split only looks at its type.)
  if (type === "DELIVERY") order = await db.order.update({ where: { id: order.id }, data: { type: "DELIVERY" } });
  return { order, table, ids };
}
const serve = async (w: W, ids: string[]) => {
  for (const id of ids) {
    await setItemStatus(w.owner, id, "PREPARING");
    await setItemStatus(w.owner, id, "READY");
    await setItemStatus(w.owner, id, "SERVED");
  }
};
const key = () => `split${uid()}${stamp}`;
const guests = (...l: string[]) => l.map((label) => ({ label }));
const itemsOf = (orderId: string) => db.orderItem.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
const worth = async (orderId: string) => (await itemsOf(orderId)).filter((i) => i.status !== "CANCELLED").reduce((s, i) => s + i.quantity * i.unitPrice, 0);

beforeAll(async () => {
  a = await world("itest-sbi-a");
  b = await world("itest-sbi-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.stockMovement.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("splitting a table's bill by item", () => {
  it("gives each guest their own bill at the same table, keeping every rupee and the first bill's number", async () => {
    const { order, table, ids } = await seat(a, [[a.momo, 3], [a.tea, 2]]);
    const before = await worth(order.id);
    const r = await splitByItem(a.cashier, order.id, {
      guests: guests("Sita", "Ram"),
      idempotencyKey: key(),
      assignments: [
        { itemId: ids[0]!, units: [[0], [0], [1]] },
        { itemId: ids[1]!, units: [[1], [1]] },
      ],
    });
    expect(r.orders).toHaveLength(2);
    expect(r.orders[0]!.id).toBe(order.id); // this bill is guest 1, same number
    const second = r.orders[1]!;
    expect(second.number).toBeGreaterThan(order.number);
    expect(second.tableId).toBe(table.id);
    expect(second.splitFromId).toBe(order.id);
    expect(second.label).toBe("Ram");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).label).toBe("Sita");
    expect((await itemsOf(order.id)).map((i) => [i.name, i.quantity])).toEqual([["Momo", 2]]);
    expect((await itemsOf(second.id)).map((i) => [i.name, i.quantity]).sort()).toEqual([["Momo", 1], ["Tea", 2]]);
    expect((await worth(order.id)) + (await worth(second.id))).toBe(before);
    // Each is a bill of its own.
    const t1 = await previewBill(a.owner, order.id, { kind: "none" });
    const t2 = await previewBill(a.owner, second.id, { kind: "none" });
    expect(t1.subtotal).toBe(50_000);
    expect(t2.subtotal).toBe(41_000);
  });

  it("is safe to repeat: the same key returns the same bills", async () => {
    const { order, ids } = await seat(a, [[a.momo, 2]]);
    const input = { guests: guests("A", "B"), idempotencyKey: key(), assignments: [{ itemId: ids[0]!, units: [[0], [1]] }] };
    const one = await splitByItem(a.cashier, order.id, input);
    const two = await splitByItem(a.cashier, order.id, input);
    expect(two.orders.map((o) => o.id)).toEqual(one.orders.map((o) => o.id));
    expect(await db.order.count({ where: { splitFromId: order.id } })).toBe(1);
  });

  it("makes more than two bills, one per guest", async () => {
    const { order, ids } = await seat(a, [[a.momo, 3]]);
    const r = await splitByItem(a.owner, order.id, { guests: guests("A", "B", "C"), idempotencyKey: key(), assignments: [{ itemId: ids[0]!, units: [[0], [1], [2]] }] });
    expect(r.orders.map((o) => o.label)).toEqual(["A", "B", "C"]);
    for (const o of r.orders) expect(await worth(o.id)).toBe(25_000);
  });

  it("shares a served dish equally, in parts that add up, and each bill pays on its own", async () => {
    const { order, ids } = await seat(a, [[a.pizza, 1], [a.tea, 3]]);
    await serve(a, ids);
    const r = await splitByItem(a.cashier, order.id, {
      guests: guests("A", "B", "C"),
      idempotencyKey: key(),
      assignments: [
        { itemId: ids[0]!, units: [[0, 1, 2]] },
        { itemId: ids[1]!, units: [[0], [1], [2]] },
      ],
    });
    const shares = (await db.orderItem.findMany({ where: { orderId: { in: r.orders.map((o) => o.id) }, shareDen: 3 } })).sort((x, y) => y.unitPrice - x.unitPrice);
    expect(shares.map((s) => s.unitPrice)).toEqual([33_334, 33_333, 33_333]);
    expect(shares.every((s) => s.name === "Pizza (1/3 share)" && s.status === "SERVED")).toBe(true);
    const sum = (await Promise.all(r.orders.map((o) => worth(o.id)))).reduce((x, y) => x + y, 0);
    expect(sum).toBe(100_000 + 3 * 8_000);
    // Pay each bill: three separate invoices, and the pizza's flour is taken off once in total (300 g), not three times.
    const before = (await db.branchStock.findMany({ where: { businessId: a.owner.businessId, stockItemId: a.flour } })).reduce((s, x) => s + x.quantity, 0);
    const invoices = [];
    for (const o of r.orders) {
      const t = await previewBill(a.owner, o.id, { kind: "none" });
      invoices.push(await checkout(a.cashier, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] }));
    }
    expect(new Set(invoices.map((i) => i.number)).size).toBe(3);
    const after = (await db.branchStock.findMany({ where: { businessId: a.owner.businessId, stockItemId: a.flour } })).reduce((s, x) => s + x.quantity, 0);
    expect(before - after).toBe(300);
  });

  it("refuses to share a dish that is still being made, but lets it go to one guest", async () => {
    const { order, ids } = await seat(a, [[a.pizza, 1], [a.tea, 1]]);
    await expect(splitByItem(a.cashier, order.id, { guests: guests("A", "B"), idempotencyKey: key(), assignments: [{ itemId: ids[0]!, units: [[0, 1]] }, { itemId: ids[1]!, units: [[1]] }] })).rejects.toThrow(/still being made/);
    expect(await db.order.count({ where: { splitFromId: order.id } })).toBe(0); // nothing was half done
    const ok = await splitByItem(a.cashier, order.id, { guests: guests("A", "B"), idempotencyKey: key(), assignments: [{ itemId: ids[0]!, units: [[0]] }, { itemId: ids[1]!, units: [[1]] }] });
    expect(ok.orders).toHaveLength(2);
  });

  it("keeps each line's kitchen progress and printed marks when it moves", async () => {
    const { order, ids } = await seat(a, [[a.momo, 2]]);
    await setItemStatus(a.owner, ids[0]!, "PREPARING");
    await db.orderItem.update({ where: { id: ids[0]! }, data: { printedAt: new Date("2026-01-01T00:00:00Z") } });
    const r = await splitByItem(a.cashier, order.id, { guests: guests("A", "B"), idempotencyKey: key(), assignments: [{ itemId: ids[0]!, units: [[0], [1]] }] });
    for (const o of r.orders) {
      const [i] = await itemsOf(o.id);
      expect(i!.status).toBe("PREPARING");
      expect(i!.printedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    }
  });
});

describe("what it refuses", () => {
  it("is for people who may move and split bills, within their own business", async () => {
    const { order, ids } = await seat(a, [[a.momo, 2]]);
    const input = { guests: guests("A", "B"), idempotencyKey: key(), assignments: [{ itemId: ids[0]!, units: [[0], [1]] }] };
    await expect(splitByItem(a.waiter, order.id, input)).rejects.toThrow(/permission/);
    await expect(splitByItem(b.owner, order.id, { ...input, idempotencyKey: key() })).rejects.toThrow(/not found/);
    expect(await db.order.count({ where: { splitFromId: order.id } })).toBe(0);
  });

  it("refuses a split that is not clean, without changing anything", async () => {
    const { order, ids } = await seat(a, [[a.momo, 2]]);
    const split = (assignments: { itemId: string; units: number[][] }[], g = guests("A", "B")) => splitByItem(a.cashier, order.id, { guests: g, idempotencyKey: key(), assignments });
    await expect(split([{ itemId: ids[0]!, units: [[0], [0]] }])).rejects.toThrow(/Guest 2 has nothing/);
    await expect(split([{ itemId: ids[0]!, units: [[0]] }])).rejects.toThrow(/all 2/);
    await expect(split([{ itemId: ids[0]!, units: [[0], [3]] }])).rejects.toThrow(/not on this bill/);
    await expect(split([{ itemId: "nope", units: [[0], [1]] }])).rejects.toThrow(/needs to be given/);
    await expect(split([{ itemId: ids[0]!, units: [[0], [1]] }], guests("A"))).rejects.toThrow(/2 and 8/);
    await expect(splitByItem(a.cashier, order.id, { guests: guests("A", "B"), idempotencyKey: "short", assignments: [] })).rejects.toThrow(/went wrong/);
    expect(await db.order.count({ where: { splitFromId: order.id } })).toBe(0);
    expect((await itemsOf(order.id)).map((i) => i.quantity)).toEqual([2]);
  });

  it("refuses a delivery bill, a paid bill and an empty bill", async () => {
    const d = await seat(a, [[a.momo, 2]], "DELIVERY");
    await expect(splitByItem(a.cashier, d.order.id, { guests: guests("A", "B"), idempotencyKey: key(), assignments: [{ itemId: d.ids[0]!, units: [[0], [1]] }] })).rejects.toThrow(/delivery/i);
    const p = await seat(a, [[a.momo, 2]]);
    const t = await previewBill(a.owner, p.order.id, { kind: "none" });
    await checkout(a.owner, p.order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    await expect(splitByItem(a.cashier, p.order.id, { guests: guests("A", "B"), idempotencyKey: key(), assignments: [{ itemId: p.ids[0]!, units: [[0], [1]] }] })).rejects.toThrow(/paid/);
    const e = await seat(a, []);
    await expect(splitByItem(a.cashier, e.order.id, { guests: guests("A", "B"), idempotencyKey: key(), assignments: [] })).rejects.toThrow(/nothing on this bill/);
  });

  it("leaves the older one-bill split working", async () => {
    const { order, ids } = await seat(a, [[a.momo, 2]]);
    const created = await splitOrder(a.owner, order.id, [{ itemId: ids[0]!, quantity: 1 }], `old-${uid()}-${stamp}`);
    expect(await worth(created.id)).toBe(25_000);
  });
});
