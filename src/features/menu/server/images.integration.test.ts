import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { openSession, getGuestView } from "@/features/guest/server/service";
import { MAX_IMAGE_BYTES } from "../image";
import { getMenuAdmin, deleteItem } from "./service";
import { getDishImage, removeDishImage, setDishImage } from "./images";

const stamp = Date.now();
const businessIds: string[] = [];

interface World {
  owner: TenantContext;
  manager: TenantContext;
  waiter: TenantContext;
  tableToken: string;
  dish: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, mgr, waiter] = await Promise.all(["owner", "mgr", "wait"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const table = await db.diningTable.create({ data: { businessId: biz.id, branchId: branch.id, areaId: area.id, label: "T1" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const dish = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 20_000 } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" },
    manager: { ...base, userId: mgr.id, role: "MANAGER" },
    waiter: { ...base, userId: waiter.id, role: "WAITER" },
    tableToken: table.publicToken,
    dish: dish.id,
  };
}

/** A tiny but real-looking JPEG: the right first bytes followed by filler. */
const jpeg = (size = 200) => {
  const b = new Uint8Array(size).fill(7);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-img-a");
  b = await makeWorld("itest-img-b");
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

describe("dish photos", () => {
  it("lets menu managers set, replace and remove a photo, and serves it publicly by the dish id", async () => {
    expect(await getDishImage(a.dish)).toBeNull();
    await setDishImage(a.manager, a.dish, jpeg(300));
    const first = await getDishImage(a.dish);
    expect(first?.contentType).toBe("image/jpeg");
    expect(first?.data.length).toBe(300);
    await setDishImage(a.owner, a.dish, jpeg(500)); // replaces, still one row
    expect((await getDishImage(a.dish))?.data.length).toBe(500);
    expect(await db.dishImage.count({ where: { menuItemId: a.dish } })).toBe(1);
    await removeDishImage(a.manager, a.dish);
    expect(await getDishImage(a.dish)).toBeNull();
    expect(await db.auditEvent.count({ where: { businessId: a.owner.businessId, action: { in: ["menu.item.photo", "menu.item.photoRemove"] } } })).toBe(3);
  });

  it("refuses the wrong people, other businesses' dishes and bad files", async () => {
    await expect(setDishImage(a.waiter, a.dish, jpeg())).rejects.toThrow(/permission/);
    await expect(removeDishImage(a.waiter, a.dish)).rejects.toThrow(/permission/);
    await expect(setDishImage(b.owner, a.dish, jpeg())).rejects.toThrow(/Item not found/);
    await expect(removeDishImage(b.owner, a.dish)).rejects.toThrow(/Item not found/);
    await expect(setDishImage(a.owner, a.dish, new Uint8Array())).rejects.toThrow(/Choose a photo/);
    await expect(setDishImage(a.owner, a.dish, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(setDishImage(a.owner, a.dish, jpeg(MAX_IMAGE_BYTES + 1))).rejects.toThrow(/too big/);
    expect(await getDishImage(a.dish)).toBeNull(); // none of the bad attempts stored anything
  });

  it("only looks up well-formed dish ids", async () => {
    for (const bad of ["", "x", "../etc/passwd", "a".repeat(80), "id with space"]) expect(await getDishImage(bad)).toBeNull();
  });

  it("shows on the staff menu and the guest menu, and goes with the dish when it is deleted", async () => {
    await setDishImage(a.owner, a.dish, jpeg());
    const admin = await getMenuAdmin(a.owner);
    const item = admin.categories.flatMap((c) => c.items).find((i) => i.id === a.dish)!;
    expect(item.image?.updatedAt).toBeInstanceOf(Date);
    const session = await openSession(a.tableToken);
    const view = await getGuestView(session as never);
    expect(view.menu.flatMap((c) => c.items).find((i) => i.id === a.dish)?.image?.updatedAt).toBeInstanceOf(Date);
    await deleteItem(a.owner, a.dish);
    expect(await db.dishImage.count({ where: { menuItemId: a.dish } })).toBe(0);
  });
});
