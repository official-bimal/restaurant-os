import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { saveFloorPlan } from "./service";

const stamp = Date.now();
let owner: TenantContext;
let waiter: TenantContext;
let businessId: string;
let hall: string;
let terrace: string;
let t1: string;
let t2: string;
let tTerrace: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `plan-${stamp}@it.test`, name: "Plan", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-plan-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  hall = (await db.area.create({ data: { businessId, branchId: branch.id, name: "Hall" } })).id;
  terrace = (await db.area.create({ data: { businessId, branchId: branch.id, name: "Terrace" } })).id;
  t1 = (await db.diningTable.create({ data: { businessId, branchId: branch.id, areaId: hall, label: "T1" } })).id;
  t2 = (await db.diningTable.create({ data: { businessId, branchId: branch.id, areaId: hall, label: "T2" } })).id;
  tTerrace = (await db.diningTable.create({ data: { businessId, branchId: branch.id, areaId: terrace, label: "P1" } })).id;
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

const at = (id: string) => db.diningTable.findFirstOrThrow({ where: { id }, select: { posX: true, posY: true } });

describe("floor plan", () => {
  it("saves where tables sit, keeping them inside the plan, and leaves other tables alone", async () => {
    await saveFloorPlan(owner, hall, [{ tableId: t1, x: 250, y: 400 }, { tableId: t2, x: 9000, y: -5 }]);
    expect(await at(t1)).toEqual({ posX: 250, posY: 400 });
    expect(await at(t2)).toEqual({ posX: 940, posY: 60 });
    expect(await at(tTerrace)).toEqual({ posX: null, posY: null });
    // Tables not listed keep their place.
    await saveFloorPlan(owner, hall, [{ tableId: t1, x: 300, y: 300 }]);
    expect(await at(t2)).toEqual({ posX: 940, posY: 60 });
  });

  it("refuses a table from another area, bad numbers, and people who cannot change tables", async () => {
    await expect(saveFloorPlan(owner, hall, [{ tableId: tTerrace, x: 100, y: 100 }])).rejects.toThrow(/not in this area/);
    await expect(saveFloorPlan(owner, hall, [{ tableId: t1, x: Number.NaN, y: 100 }])).rejects.toThrow(/numbers/);
    await expect(saveFloorPlan(owner, "no-such-area", [])).rejects.toThrow(/not found/);
    await expect(saveFloorPlan(waiter, hall, [{ tableId: t1, x: 1, y: 1 }])).rejects.toThrow(/permission/);
  });

  it("clearing an area puts its tables back in rows, and only that area", async () => {
    await saveFloorPlan(owner, terrace, [{ tableId: tTerrace, x: 500, y: 500 }]);
    await saveFloorPlan(owner, hall, null);
    expect(await at(t1)).toEqual({ posX: null, posY: null });
    expect(await at(tTerrace)).toEqual({ posX: 500, posY: 500 });
  });
});
