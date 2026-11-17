import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { getGuestView, openSession } from "@/features/guest/server/service";
import { cleanNameNe, createCategory, createItem, getMenuAdmin, renameCategory, updateItem } from "./service";

const stamp = Date.now();
const businessIds: string[] = [];

interface World {
  owner: TenantContext;
  waiter: TenantContext;
  tableToken: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, waiter] = await Promise.all(["owner", "wait"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const table = await db.diningTable.create({ data: { businessId: biz.id, branchId: branch.id, areaId: area.id, label: "T1" } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return { owner: { ...base, userId: owner.id, role: "OWNER" }, waiter: { ...base, userId: waiter.id, role: "WAITER" }, tableToken: table.publicToken };
}

let a: World;

beforeAll(async () => {
  a = await makeWorld("itest-ne-a");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("cleanNameNe", () => {
  it("keeps undefined as 'leave it', clears empty values, tidies spacing and drops control characters", () => {
    expect(cleanNameNe(undefined)).toBeUndefined();
    expect(cleanNameNe(null)).toBeNull();
    expect(cleanNameNe("")).toBeNull();
    expect(cleanNameNe("   ")).toBeNull();
    expect(cleanNameNe("  बफ   मोमो ")).toBe("बफ मोमो");
    expect(cleanNameNe("मोमो\u0000\u0007x")).toBe("मोमो x");
  });
  it("refuses more than 80 characters", () => {
    expect(cleanNameNe("क".repeat(80))).toHaveLength(80);
    expect(() => cleanNameNe("क".repeat(81))).toThrow(/80 characters/);
  });
});

describe("Nepali names for categories and dishes", () => {
  it("saves them with a category and a dish, keeps them when later edits leave them out, and clears them when emptied", async () => {
    const cat = await createCategory(a.owner, "Snacks", "खाजा");
    expect(cat.nameNe).toBe("खाजा");
    const item = await createItem(a.owner, { categoryId: cat.id, stationId: null, name: "Buff Momo", nameNe: "बफ मोमो", price: 25_000, prepMinutes: 15 });
    expect(item.nameNe).toBe("बफ मोमो");

    // an update that does not mention it leaves it alone
    await updateItem(a.owner, item.id, { categoryId: cat.id, stationId: null, name: "Buff Momo", price: 26_000, prepMinutes: 15 });
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: item.id } })).nameNe).toBe("बफ मोमो");
    await renameCategory(a.owner, cat.id, "Snacks");
    expect((await db.menuCategory.findUniqueOrThrow({ where: { id: cat.id } })).nameNe).toBe("खाजा");

    // changing it, then emptying it
    await updateItem(a.owner, item.id, { categoryId: cat.id, stationId: null, name: "Buff Momo", nameNe: "बफ मःम", price: 26_000, prepMinutes: 15 });
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: item.id } })).nameNe).toBe("बफ मःम");
    await updateItem(a.owner, item.id, { categoryId: cat.id, stationId: null, name: "Buff Momo", nameNe: "", price: 26_000, prepMinutes: 15 });
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: item.id } })).nameNe).toBeNull();
    await renameCategory(a.owner, cat.id, "Snacks", "");
    expect((await db.menuCategory.findUniqueOrThrow({ where: { id: cat.id } })).nameNe).toBeNull();
  });

  it("is limited to people who manage the menu, and over-long names are refused", async () => {
    await expect(createCategory(a.waiter, "Nope", "नाम")).rejects.toThrow(/permission/);
    await expect(createCategory(a.owner, "Long", "क".repeat(81))).rejects.toThrow(/80 characters/);
    expect(await db.menuCategory.count({ where: { businessId: a.owner.businessId, name: "Long" } })).toBe(0);
  });

  it("reaches the staff menu page data and the guest menu", async () => {
    const cat = await createCategory(a.owner, "Drinks", "पेय");
    await createItem(a.owner, { categoryId: cat.id, stationId: null, name: "Tea", nameNe: "चिया", price: 5_000, prepMinutes: 5 });
    const admin = await getMenuAdmin(a.owner);
    expect(admin.categories.find((c) => c.name === "Drinks")?.nameNe).toBe("पेय");
    const session = await openSession(a.tableToken);
    const view = await getGuestView(session as never);
    const drinks = view.menu.find((c) => c.name === "Drinks")!;
    expect(drinks.nameNe).toBe("पेय");
    expect(drinks.items[0]).toMatchObject({ name: "Tea", nameNe: "चिया" });
  });
});
