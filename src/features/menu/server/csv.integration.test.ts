import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { applyMenuImport, exportMenuCsv, previewMenuImport } from "./csv";

const stamp = Date.now();
let owner: TenantContext;
let waiter: TenantContext;
let businessId: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `mcsv-${stamp}@it.test`, name: "M", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-mcsv-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const bar = await db.station.create({ data: { businessId, name: "Bar" } });
  const cat = await db.menuCategory.create({ data: { businessId, name: "Hot Coffee" } });
  await db.menuItem.create({ data: { businessId, categoryId: cat.id, stationId: bar.id, name: "Latte", price: 20_000, prepMinutes: 5 } });
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  waiter = { ...base, role: "WAITER" };
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

describe("menu spreadsheet", () => {
  it("exports the menu in the columns the import reads", async () => {
    const csv = await exportMenuCsv(owner);
    expect(csv.split("\r\n")[0]).toBe("Category,Name,Nepali name,Price,Station,Prep minutes,Available");
    expect(csv).toContain("Hot Coffee,Latte,,200,Bar,5,yes");
    const p = await previewMenuImport(owner, csv);
    expect(p.counts).toEqual({ add: 0, update: 0, same: 1, errors: 0 });
  });

  it("previews without saving, then applies: new dishes, new categories and stations, a changed price", async () => {
    const file = "Category,Name,Price,Station,Available\nHot Coffee,Latte,220,Bar,yes\nHot Coffee,Mocha,240,Bar,yes\nSnacks,Fries,210,Kitchen,no\nSnacks,,5,,\n";
    const p = await previewMenuImport(owner, file);
    expect(p.counts).toEqual({ add: 2, update: 1, same: 0, errors: 1 });
    expect(await db.menuItem.count({ where: { businessId } })).toBe(1); // nothing saved by a preview

    const r = await applyMenuImport(owner, file);
    expect(r).toMatchObject({ added: 2, updated: 1, unchanged: 0 });
    expect(r.skipped).toHaveLength(1);
    const items = await db.menuItem.findMany({ where: { businessId }, include: { category: true, station: true }, orderBy: { name: "asc" } });
    expect(items.map((i) => [i.name, i.price, i.category.name, i.station?.name, i.available])).toEqual([
      ["Fries", 21_000, "Snacks", "Kitchen", false],
      ["Latte", 22_000, "Hot Coffee", "Bar", true],
      ["Mocha", 24_000, "Hot Coffee", "Bar", true],
    ]);
    expect(await db.menuCategory.count({ where: { businessId } })).toBe(2);
    expect(await db.station.count({ where: { businessId } })).toBe(2);
  });

  it("is safe to apply again, never deletes a dish left out, and does not touch what the file does not mention", async () => {
    await db.menuItem.updateMany({ where: { businessId, name: "Mocha" }, data: { nameNe: "मोचा" } });
    const r = await applyMenuImport(owner, "Name,Price\nLatte,220\n");
    expect(r).toMatchObject({ added: 0, updated: 0, unchanged: 1 }); // no category in the file: the dish stays in Hot Coffee, nothing changes
    expect(await db.menuItem.count({ where: { businessId } })).toBe(3); // nothing was deleted
    expect((await db.menuItem.findFirstOrThrow({ where: { businessId, name: "Mocha" } })).nameNe).toBe("मोचा");
    const again = await applyMenuImport(owner, "Name,Price\nLatte,230\nCake,150\n");
    expect(again).toMatchObject({ added: 1, updated: 1, unchanged: 0 });
    expect((await db.menuItem.findFirstOrThrow({ where: { businessId, name: "Latte" }, include: { category: true } })).category.name).toBe("Hot Coffee");
    expect((await db.menuItem.findFirstOrThrow({ where: { businessId, name: "Cake" }, include: { category: true } })).category.name).toBe("Menu");
  });

  it("refuses a file with nothing usable, a huge file, and people who do not manage the menu", async () => {
    await expect(applyMenuImport(owner, "Name,Price\n,abc\n")).rejects.toThrow(/no name|nothing to import/i);
    await expect(previewMenuImport(owner, "x".repeat(1_000_001))).rejects.toThrow(/too big/);
    await expect(previewMenuImport(owner, "")).rejects.toThrow(/Choose a file/);
    await expect(exportMenuCsv(waiter)).rejects.toThrow(/permission/);
    await expect(applyMenuImport(waiter, "Name,Price\nA,1\n")).rejects.toThrow(/permission/);
  });
});
