import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { addItem, createOrder } from "@/features/orders/server/service";
import {
  createCategory,
  createItem,
  createStation,
  deleteCategory,
  deleteItem,
  deleteStation,
  getMenuAdmin,
  renameCategory,
  setItemAvailable,
  updateItem,
} from "./service";
import {
  createArea,
  createTable,
  deleteArea,
  deleteTable,
  getFloorAdmin,
  updateTable,
} from "@/features/floor/server/service";

let a: TenantContext;
let b: TenantContext;
const businessIds: string[] = [];

async function makeTenant(name: string): Promise<TenantContext> {
  const user = await db.user.create({ data: { email: `${name}-${Date.now()}@it.test`, name, passwordHash: "x" } });
  const biz = await db.business.create({
    data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } },
  });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main branch" } });
  return { userId: user.id, businessId: biz.id, branchId: branch.id, branchIds: [branch.id], role: "OWNER" };
}

beforeAll(async () => {
  a = await makeTenant("itest-menu-a");
  b = await makeTenant("itest-menu-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("menu management", () => {
  let categoryId: string;
  let stationId: string;
  let itemId: string;

  it("creates categories and stations and refuses duplicate names", async () => {
    const cat = await createCategory(a, "  Hot   Drinks ");
    expect(cat.name).toBe("Hot Drinks"); // trimmed and collapsed
    categoryId = cat.id;
    await expect(createCategory(a, "Hot Drinks")).rejects.toThrow("already exists");
    await expect(createCategory(a, "hot drinks")).rejects.toThrow("already exists"); // ignoring case
    await expect(renameCategory(a, cat.id, "HOT DRINKS")).resolves.toBeUndefined(); // renaming to itself is fine
    // The same name is fine in another business.
    await expect(createCategory(b, "Hot Drinks")).resolves.toBeTruthy();
    stationId = (await createStation(a, "Bar")).id;
  });

  it("creates and edits items, validating price and time", async () => {
    const item = await createItem(a, { categoryId, stationId, name: "Masala Tea", price: 8_000, prepMinutes: 5 });
    itemId = item.id;
    await expect(
      createItem(a, { categoryId, stationId, name: "Bad", price: -1, prepMinutes: 5 }),
    ).rejects.toThrow(DomainError);
    await expect(
      createItem(a, { categoryId, stationId, name: "Bad", price: 100, prepMinutes: 0 }),
    ).rejects.toThrow(DomainError);
    await updateItem(a, itemId, { categoryId, stationId, name: "Masala Chiya", price: 9_000, prepMinutes: 5 });
    const { categories } = await getMenuAdmin(a);
    expect(categories[0].items[0]).toMatchObject({ name: "Masala Chiya", price: 9_000 });
  });

  it("never lets one business touch or reference another's menu", async () => {
    const foreign = await createCategory(b, "Other");
    await expect(
      createItem(a, { categoryId: foreign.id, stationId: null, name: "X", price: 100, prepMinutes: 5 }),
    ).rejects.toThrow("Category not found");
    await expect(
      createItem(a, { categoryId, stationId: (await createStation(b, "B Bar")).id, name: "X", price: 100, prepMinutes: 5 }),
    ).rejects.toThrow("Station not found");
    await expect(updateItem(b, itemId, { categoryId: foreign.id, stationId: null, name: "Hijack", price: 1, prepMinutes: 1 })).rejects.toThrow("Item not found");
    await expect(setItemAvailable(b, itemId, false)).rejects.toThrow("Item not found");
    await expect(deleteItem(b, itemId)).rejects.toThrow("Item not found");
    await expect(renameCategory(b, categoryId, "Hijack")).rejects.toThrow("Category not found");
    await expect(deleteCategory(b, categoryId)).rejects.toThrow("Category not found");
    expect((await getMenuAdmin(b)).categories.flatMap((c) => c.items)).toHaveLength(0);
  });

  it("hides an unavailable item from ordering", async () => {
    await setItemAvailable(a, itemId, false);
    const table = await createArea(a, "Hall").then((ar) => createTable(a, { areaId: ar.id, label: "H1", capacity: 4 }));
    const order = await createOrder(a, { type: "DINE_IN", tableId: table.id, idempotencyKey: "menu-test-1" });
    await expect(addItem(a, order.id, { menuItemId: itemId, quantity: 1 })).rejects.toThrow("not available");
    await setItemAvailable(a, itemId, true);
    await addItem(a, order.id, { menuItemId: itemId, quantity: 1 });
  });

  it("keeps history: an ordered item cannot be deleted, and old prices do not change", async () => {
    await expect(deleteItem(a, itemId)).rejects.toThrow("ordered before");
    await updateItem(a, itemId, { categoryId, stationId, name: "Masala Chiya", price: 12_000, prepMinutes: 5 });
    const oi = await db.orderItem.findFirstOrThrow({ where: { businessId: a.businessId, menuItemId: itemId } });
    expect(oi.unitPrice).toBe(9_000); // snapshot taken when ordered
  });

  it("refuses to delete a category or station that is still in use", async () => {
    await expect(deleteCategory(a, categoryId)).rejects.toThrow("first");
    await expect(deleteStation(a, stationId)).rejects.toThrow("Reassign");
    const empty = await createCategory(a, "Empty");
    await deleteCategory(a, empty.id);
  });

  it("enforces roles", async () => {
    const waiter: TenantContext = { ...a, role: "WAITER" };
    await expect(createCategory(waiter, "Nope")).rejects.toThrow("permission");
    await expect(createArea(waiter, "Nope")).rejects.toThrow("permission");
  });
});

describe("floor management", () => {
  it("creates areas and tables with validation and unique labels", async () => {
    const area = await createArea(a, "Terrace");
    await expect(createArea(a, "Terrace")).rejects.toThrow("already exists");
    const t = await createTable(a, { areaId: area.id, label: "R1", capacity: 2 });
    await expect(createTable(a, { areaId: area.id, label: "R1", capacity: 2 })).rejects.toThrow("already exists");
    await expect(createTable(a, { areaId: area.id, label: "r1", capacity: 2 })).rejects.toThrow("already exists");
    await expect(createArea(a, "terrace")).rejects.toThrow("already exists");
    await expect(createTable(a, { areaId: area.id, label: "R2", capacity: 0 })).rejects.toThrow("Seats");
    await updateTable(a, t.id, { areaId: area.id, label: "R1", capacity: 6 });
    const floor = await getFloorAdmin(a);
    expect(floor.find((x) => x.name === "Terrace")?.tables[0].capacity).toBe(6);
  });

  it("keeps businesses apart", async () => {
    const floorB = await createArea(b, "B Hall");
    const mine = (await getFloorAdmin(a)).flatMap((x) => x.tables)[0];
    await expect(createTable(a, { areaId: floorB.id, label: "Z1", capacity: 2 })).rejects.toThrow("Area not found");
    await expect(updateTable(b, mine.id, { areaId: floorB.id, label: "Z", capacity: 2 })).rejects.toThrow("Table not found");
    await expect(deleteTable(b, mine.id)).rejects.toThrow("Table not found");
    await expect(deleteArea(b, mine.areaId)).rejects.toThrow("Area not found");
  });

  it("refuses to delete areas with tables, or tables in use or with history", async () => {
    const floor = await getFloorAdmin(a);
    const terrace = floor.find((x) => x.name === "Terrace")!;
    await expect(deleteArea(a, terrace.id)).rejects.toThrow("first");
    const hall = floor.find((x) => x.name === "Hall")!;
    const h1 = hall.tables[0]; // has an open order from the menu tests
    await expect(deleteTable(a, h1.id)).rejects.toThrow("in use");
    // a table that was never used can go, then its empty area
    const r1 = terrace.tables[0];
    await deleteTable(a, r1.id);
    await deleteArea(a, terrace.id);
  });
});
