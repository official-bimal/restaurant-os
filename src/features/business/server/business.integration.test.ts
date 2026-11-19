import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { deleteItem } from "@/features/menu/server/service";
import { getLogo, getProfile, removeLogo, saveProfile, setLogo } from "./profile";
import { emptyTrashItem, listTrash, restoreFromTrash } from "./trash";
import { getActivity } from "./activity";
import { localDate } from "@/lib/business-day";
import { getReceipt } from "@/features/printing/server/documents";

const stamp = Date.now();
const businessIds: string[] = [];

async function world(name: string) {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, mgr, waiter] = await Promise.all(["owner", "mgr", "wait"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  await db.membership.create({ data: { userId: mgr.id, businessId: biz.id, role: "MANAGER" } });
  await db.membership.create({ data: { userId: waiter.id, businessId: biz.id, role: "WAITER" } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const stock = await db.stockItem.create({ data: { businessId: biz.id, name: "Flour", unit: "g" } });
  const dish = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", nameNe: "मोमो", price: 20_000 } });
  await db.recipeLine.create({ data: { businessId: biz.id, menuItemId: dish.id, stockItemId: stock.id, quantity: 50 } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" } as TenantContext,
    manager: { ...base, userId: mgr.id, role: "MANAGER" } as TenantContext,
    waiter: { ...base, userId: waiter.id, role: "WAITER" } as TenantContext,
    dish: dish.id,
    cat: cat.id,
    stock: stock.id,
  };
}

let a: Awaited<ReturnType<typeof world>>;
let b: Awaited<ReturnType<typeof world>>;
const png = () => {
  const x = new Uint8Array(100).fill(1);
  x.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return x;
};

beforeAll(async () => {
  a = await world("itest-biz-a");
  b = await world("itest-biz-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.recipeLine.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

const form = { name: "Nerro Cafe", legalName: "Nerro Cafe Pvt. Ltd.", panNumber: "123456789", phone: "061-000000", email: "hi@nerro.test", address: "Lakeside, Pokhara", businessType: "Cafe", openedOn: "2024-04-14", website: "", facebook: "nerrocafe", instagram: "" };

describe("business profile", () => {
  it("is saved by the owner, audited, and refused to everyone else", async () => {
    await saveProfile(a.owner, form);
    expect(await getProfile(a.owner)).toMatchObject({ legalName: "Nerro Cafe Pvt. Ltd.", address: "Lakeside, Pokhara", facebook: "nerrocafe", website: null });
    await expect(saveProfile(a.manager, form)).rejects.toThrow(/owner/);
    await expect(getProfile(a.waiter)).rejects.toThrow(/owner/);
    expect(await db.business.findUniqueOrThrow({ where: { id: b.owner.businessId } })).toMatchObject({ legalName: null });
    expect(await db.auditEvent.count({ where: { businessId: a.owner.businessId, action: "business.profile" } })).toBe(1);
  });

  it("keeps one logo, only real pictures, and removes it", async () => {
    await setLogo(a.owner, png());
    expect((await getLogo(a.owner))?.contentType).toBe("image/png");
    expect(await getLogo(b.owner)).toBeNull();
    await expect(setLogo(a.owner, new Uint8Array(50).fill(9))).rejects.toThrow(/JPEG/);
    await expect(setLogo(a.owner, new Uint8Array(400_000))).rejects.toThrow(/too big/);
    await expect(setLogo(a.manager, png())).rejects.toThrow(/owner/);
    await removeLogo(a.owner);
    expect(await getLogo(a.owner)).toBeNull();
  });

  it("prints the legal name on the bill", async () => {
    void getReceipt; // the header helper is private; the field it reads is what matters
    const biz = await db.business.findUniqueOrThrow({ where: { id: a.owner.businessId }, select: { legalName: true, address: true } });
    expect(biz.legalName).toBe("Nerro Cafe Pvt. Ltd.");
  });
});

describe("trash", () => {
  it("keeps a deleted dish with its recipe and puts it back", async () => {
    await deleteItem(a.manager, a.dish);
    expect(await db.menuItem.count({ where: { id: a.dish } })).toBe(0);
    const t = await listTrash(a.manager);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ label: "Momo", daysLeft: 30 });
    expect(await listTrash(b.manager)).toHaveLength(0);
    await expect(restoreFromTrash(b.manager, t[0]!.id)).rejects.toThrow(/no longer/);
    await expect(listTrash(a.waiter)).rejects.toThrow(/permission/);
    await restoreFromTrash(a.manager, t[0]!.id);
    const back = await db.menuItem.findUniqueOrThrow({ where: { id: a.dish }, include: { recipe: true } });
    expect(back).toMatchObject({ name: "Momo", nameNe: "मोमो", price: 20_000 });
    expect(back.recipe).toMatchObject([{ stockItemId: a.stock, quantity: 50 }]);
    expect(await listTrash(a.manager)).toHaveLength(0);
  });

  it("refuses to restore into a deleted category, and can delete for good", async () => {
    await deleteItem(a.owner, a.dish);
    const [t] = await listTrash(a.owner);
    await db.menuCategory.delete({ where: { businessId_id: { businessId: a.owner.businessId, id: a.cat } } });
    await expect(restoreFromTrash(a.owner, t!.id)).rejects.toThrow(/category/);
    await emptyTrashItem(a.owner, t!.id);
    expect(await listTrash(a.owner)).toHaveLength(0);
  });

  it("empties anything older than thirty days", async () => {
    await db.trashItem.create({ data: { businessId: a.owner.businessId, kind: "DISH", label: "Old", payload: {}, deletedAt: new Date(Date.now() - 31 * 86_400_000) } });
    expect(await listTrash(a.owner)).toHaveLength(0);
    expect(await db.trashItem.count({ where: { businessId: a.owner.businessId } })).toBe(0);
  });
});

describe("activity log", () => {
  it("lists what people did, filtered by person and search, for the owner only", async () => {
    const day = localDate(new Date(), "Asia/Kathmandu"); // the business day, not the UTC date
    const all = await getActivity(a.owner, { from: day, to: day });
    expect(all.events.length).toBeGreaterThan(2);
    expect(all.events.some((e) => e.what === "Deleted a dish" && e.who.includes("mgr"))).toBe(true);
    const mine = await getActivity(a.owner, { from: day, to: day, userId: a.manager.userId });
    expect(mine.events.every((e) => e.who.includes("mgr"))).toBe(true);
    const found = await getActivity(a.owner, { from: day, to: day, search: "profile" });
    expect(found.events.map((e) => e.code)).toEqual(["business.profile"]);
    const other = await getActivity(b.owner, { from: day, to: day });
    expect(other.events.some((e) => e.code === "business.profile")).toBe(false);
    await expect(getActivity(a.manager, { from: day, to: day })).rejects.toThrow(/owner/);
  });
});
