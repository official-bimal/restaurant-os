import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import {
  addItem,
  cancelItem,
  checkout,
  createOrder,
  DomainError,
  getOrder,
  kitchenTickets,
  setItemStatus,
} from "./service";

interface World {
  ctx: TenantContext;
  other: TenantContext;
  tableId: string;
  menuItemId: string;
  businessIds: string[];
}

let w: World;

async function makeBusiness(name: string) {
  const user = await db.user.create({
    data: { email: `${name}-${Date.now()}@it.test`, name, passwordHash: "x" },
  });
  const business = await db.business.create({
    data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } },
  });
  const branch = await db.branch.create({ data: { businessId: business.id, name: "Main branch" } });
  const area = await db.area.create({ data: { businessId: business.id, branchId: branch.id, name: "Main" } });
  const table = await db.diningTable.create({
    data: { businessId: business.id, branchId: branch.id, areaId: area.id, label: "T1" },
  });
  const cat = await db.menuCategory.create({ data: { businessId: business.id, name: "Food" } });
  const item = await db.menuItem.create({
    data: { businessId: business.id, categoryId: cat.id, name: "Momo", price: 20_000 },
  });
  const ctx: TenantContext = { userId: user.id, businessId: business.id, branchId: branch.id, branchIds: [branch.id], role: "OWNER" };
  return { ctx, tableId: table.id, menuItemId: item.id, userId: user.id };
}

beforeAll(async () => {
  const a = await makeBusiness("itest-a");
  const b = await makeBusiness("itest-b");
  w = {
    ctx: a.ctx,
    other: b.ctx,
    tableId: a.tableId,
    menuItemId: a.menuItemId,
    businessIds: [a.ctx.businessId, b.ctx.businessId],
  };
});

async function removeBusiness(id: string) {
  const memberships = await db.membership.findMany({ where: { businessId: id } });
  // Children first: OrderItem -> MenuItem has no cascade.
  await db.payment.deleteMany({ where: { businessId: id } });
  await db.invoice.deleteMany({ where: { businessId: id } });
  await db.orderItem.deleteMany({ where: { businessId: id } });
  await db.order.deleteMany({ where: { businessId: id } });
  await db.business.delete({ where: { id } });
  await db.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
}

afterAll(async () => {
  for (const id of w.businessIds) await removeBusiness(id);
  await db.$disconnect();
});

describe("order service", () => {
  let orderId: string;

  it("creates an order and is idempotent for the same key", async () => {
    const key = "key-1";
    const first = await createOrder(w.ctx, { type: "DINE_IN", tableId: w.tableId, idempotencyKey: key });
    const second = await createOrder(w.ctx, { type: "DINE_IN", tableId: w.tableId, idempotencyKey: key });
    expect(second.id).toBe(first.id);
    expect(first.number).toBe(1);
    orderId = first.id;
    const count = await db.order.count({ where: { businessId: w.ctx.businessId } });
    expect(count).toBe(1);
  });

  // The embedded dev database (PGlite, port 5433) serves one connection at a
  // time, so a true concurrent race can only be exercised on a real Postgres.
  const embedded = (process.env.DATABASE_URL ?? "").includes(":5433");
  it.skipIf(embedded)("survives two simultaneous submits with the same key", async () => {
    const key = "key-race";
    const [a, b] = await Promise.all([
      createOrder(w.ctx, { type: "TAKEAWAY", idempotencyKey: key }),
      createOrder(w.ctx, { type: "TAKEAWAY", idempotencyKey: key }),
    ]);
    expect(a.id).toBe(b.id);
  });

  it("refuses a second open order on the same table", async () => {
    await expect(
      createOrder(w.ctx, { type: "DINE_IN", tableId: w.tableId, idempotencyKey: "key-2" }),
    ).rejects.toThrow(DomainError);
  });

  it("keeps businesses apart", async () => {
    expect(await getOrder(w.other, orderId)).toBeNull();
    await expect(addItem(w.other, orderId, { menuItemId: w.menuItemId, quantity: 1 })).rejects.toThrow();
    await expect(
      createOrder(w.other, { type: "DINE_IN", tableId: w.tableId, idempotencyKey: "k-x" }),
    ).rejects.toThrow("Table not found");
    expect((await kitchenTickets(w.other)).length).toBe(0);
  });

  it("derives the order status from its items", async () => {
    const item = await addItem(w.ctx, orderId, { menuItemId: w.menuItemId, quantity: 2 });
    expect((await getOrder(w.ctx, orderId))?.status).toBe("OPEN");
    await setItemStatus(w.ctx, item.id, "PREPARING");
    await setItemStatus(w.ctx, item.id, "READY");
    await expect(setItemStatus(w.ctx, item.id, "PENDING")).rejects.toThrow(DomainError);
    await setItemStatus(w.ctx, item.id, "SERVED");
    expect((await getOrder(w.ctx, orderId))?.status).toBe("SERVED");
  });

  it("needs a reason to cancel and ignores cancelled items in the bill", async () => {
    const extra = await addItem(w.ctx, orderId, { menuItemId: w.menuItemId, quantity: 1 });
    await expect(cancelItem(w.ctx, extra.id, " ")).rejects.toThrow(DomainError);
    await cancelItem(w.ctx, extra.id, "guest changed mind");
    expect((await getOrder(w.ctx, orderId))?.status).toBe("SERVED");
  });

  it("checks out with exact payments and numbers the invoice", async () => {
    // 2 x Rs 200 = 400 -> +10% 40 -> 440 -> +13% 57.20 -> 497.20 -> rounds to 497
    await expect(
      checkout(w.ctx, orderId, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 40_000 }] }),
    ).rejects.toThrow("add up");
    const invoice = await checkout(w.ctx, orderId, {
      discount: { kind: "none" },
      payments: [
        { method: "CASH", amount: 30_000 },
        { method: "QR", amount: 19_700 },
      ],
    });
    expect(invoice.number).toBe(1);
    expect(invoice.grandTotal).toBe(49_700);
    const order = await getOrder(w.ctx, orderId);
    expect(order?.status).toBe("PAID");
    const table = await db.diningTable.findFirstOrThrow({ where: { id: w.tableId } });
    expect(table.state).toBe("FREE");
  });

  it("cannot pay or edit a paid order", async () => {
    await expect(
      checkout(w.ctx, orderId, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 49_700 }] }),
    ).rejects.toThrow("already paid");
    await expect(addItem(w.ctx, orderId, { menuItemId: w.menuItemId, quantity: 1 })).rejects.toThrow("closed");
  });

  it("enforces roles", async () => {
    const waiter: TenantContext = { ...w.ctx, role: "WAITER" };
    await expect(
      checkout(waiter, orderId, { discount: { kind: "none" }, payments: [] }),
    ).rejects.toThrow("permission");
    const audit = await db.auditEvent.count({ where: { businessId: w.ctx.businessId } });
    expect(audit).toBeGreaterThan(5);
  });
});
