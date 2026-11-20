import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { itemAt, makeStockItem } from "./test-support";
import { recordWaste } from "./service";
import { getCountSheet, listCountSheets, recordCountSheet, wasteReport } from "./counts";

const stamp = Date.now();
let businessId: string;
let branchId: string;
let owner: TenantContext;
let manager: TenantContext;
let kitchen: TenantContext;
let flour: string;
let milk: string;
let eggs: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `cnt-${stamp}@it.test`, name: "Cnt", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-cnt-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  branchId = branch.id;
  const base = { userId: user.id, businessId, branchId, branchIds: [branchId] };
  owner = { ...base, role: "OWNER" };
  manager = { ...base, role: "MANAGER" };
  kitchen = { ...base, role: "KITCHEN" };
  // Flour 10 kg, milk 5 L, eggs 30 pieces. The cost of one unit is in thousandths of a paisa.
  flour = (await makeStockItem(businessId, branchId, { name: "Flour", unit: "g", quantity: 10_000, costMilli: 100 })).id;
  milk = (await makeStockItem(businessId, branchId, { name: "Milk", unit: "ml", quantity: 5_000, costMilli: 150 })).id;
  eggs = (await makeStockItem(businessId, branchId, { name: "Eggs", unit: "piece", quantity: 30, costMilli: 15_000 })).id;
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

describe("a count sheet", () => {
  it("corrects only the items that were counted and keeps the differences as one count", async () => {
    const r = await recordCountSheet(manager, {
      lines: [
        { stockItemId: flour, counted: 9_500 }, // 500 g short
        { stockItemId: milk, counted: 5_000 }, // same
      ],
      note: "Sunday close",
    });
    expect(r).toMatchObject({ counted: 2, changed: 1 });
    expect((await itemAt(flour)).quantity).toBe(9_500);
    expect((await itemAt(milk)).quantity).toBe(5_000);
    expect((await itemAt(eggs)).quantity).toBe(30); // not on the sheet: untouched
    expect(r.valueChange).toBeLessThan(0);

    const moves = await db.stockMovement.findMany({ where: { businessId, countId: r.id } });
    expect(moves).toHaveLength(1); // the item that matched leaves no movement
    expect(moves[0]).toMatchObject({ kind: "COUNT", quantity: -500, note: "Sunday close" });
    expect(moves[0]!.totalCost).toBe(r.valueChange);

    const sheet = await getCountSheet(manager, r.id);
    expect(sheet.sheet).toMatchObject({ itemsCounted: 2, itemsChanged: 1, note: "Sunday close" });
    expect(sheet.moves.map((m) => m.stockItem.name)).toEqual(["Flour"]);
    expect((await listCountSheets(manager)).map((s) => s.id)).toContain(r.id);
  });

  it("can find more than the book says, and counts down to zero", async () => {
    const r = await recordCountSheet(owner, { lines: [{ stockItemId: eggs, counted: 36 }, { stockItemId: milk, counted: 0 }] });
    expect(r.changed).toBe(2);
    expect((await itemAt(eggs)).quantity).toBe(36);
    expect((await itemAt(milk)).quantity).toBe(0);
    const eggLine = r.lines.find((l) => l.stockItemId === eggs)!;
    expect(eggLine).toMatchObject({ was: 30, counted: 36, difference: 6 });
    expect(eggLine.value).toBeGreaterThan(0);
  });

  it("refuses bad sheets without changing anything", async () => {
    await expect(recordCountSheet(manager, { lines: [] })).rejects.toThrow(/at least one/);
    await expect(recordCountSheet(manager, { lines: [{ stockItemId: flour, counted: -1 }] })).rejects.toThrow(/whole number/);
    await expect(recordCountSheet(manager, { lines: [{ stockItemId: flour, counted: 1.5 }] })).rejects.toThrow(/whole number/);
    await expect(recordCountSheet(manager, { lines: [{ stockItemId: flour, counted: 1 }, { stockItemId: flour, counted: 2 }] })).rejects.toThrow(/once/);
    await expect(recordCountSheet(manager, { lines: [{ stockItemId: "nope", counted: 1 }] })).rejects.toThrow(/not found/);
    // A bad line late in the sheet rolls the whole sheet back.
    const before = (await itemAt(flour)).quantity;
    await expect(recordCountSheet(manager, { lines: [{ stockItemId: flour, counted: 1 }, { stockItemId: "nope", counted: 1 }] })).rejects.toThrow(/not found/);
    expect((await itemAt(flour)).quantity).toBe(before);
    await expect(recordCountSheet(kitchen, { lines: [{ stockItemId: flour, counted: 1 }] })).rejects.toThrow(/permission/);
  });

  it("does not show another business's sheet", async () => {
    const other = await db.business.create({ data: { name: `itest-cnt-other-${stamp}` } });
    const branch = await db.branch.create({ data: { businessId: other.id, name: "Other" } });
    const stranger: TenantContext = { userId: owner.userId, businessId: other.id, branchId: branch.id, branchIds: [branch.id], role: "OWNER" };
    const mine = (await listCountSheets(manager))[0]!;
    await expect(getCountSheet(stranger, mine.id)).rejects.toThrow(/not found/);
    await db.business.delete({ where: { id: other.id } });
  });
});

describe("waste by cause", () => {
  it("records the cause, and adds waste up by cause and by item", async () => {
    await recordWaste(kitchen, { stockItemId: flour, quantity: 200, reason: "", category: "SPOILED" });
    await recordWaste(kitchen, { stockItemId: eggs, quantity: 4, reason: "tray fell", category: "DROPPED" });
    await recordWaste(kitchen, { stockItemId: flour, quantity: 100, reason: "mouse got in" }); // no cause given
    await expect(recordWaste(kitchen, { stockItemId: flour, quantity: 1, reason: "x", category: "BOGUS" })).rejects.toThrow(/Choose why/);
    await expect(recordWaste(kitchen, { stockItemId: flour, quantity: 1, reason: "" })).rejects.toThrow(/reason/);

    const spoiled = await db.stockMovement.findFirstOrThrow({ where: { businessId, kind: "WASTE", reason: "SPOILED" } });
    expect(spoiled.note).toBe("Spoiled"); // the cause's own name stands in when no details are given
    const report = await wasteReport(manager);
    expect(report.entries).toBe(3);
    // Costs are in thousandths of a paisa: 300 g of flour at 100 = 30 paisa, and 4 eggs at 15,000 = 60 paisa.
    expect(report.total).toBe(90);
    expect(report.byReason.reduce((n, r) => n + r.cost, 0)).toBe(report.total);
    expect(report.byReason.map((r) => r.label).sort()).toEqual(["Dropped or spilled", "Not said", "Spoiled"]);
    expect(report.byItem.find((i) => i.name === "Flour")).toMatchObject({ quantity: 300, entries: 2 });
    expect(report.byItem.find((i) => i.name === "Eggs")).toMatchObject({ quantity: 4, entries: 1 });
  });

  it("only shows the report to people who may see costs, and checks the dates", async () => {
    await expect(wasteReport(kitchen)).rejects.toThrow(/permission/);
    await expect(wasteReport(manager, { from: "2026-02-01", to: "2026-01-01" })).rejects.toThrow(/start date/);
    await expect(wasteReport(manager, { from: "nope" })).rejects.toThrow(/valid dates/);
    const empty = await wasteReport(manager, { from: "2020-01-01", to: "2020-01-31" });
    expect(empty).toMatchObject({ entries: 0, total: 0 });
  });
});
