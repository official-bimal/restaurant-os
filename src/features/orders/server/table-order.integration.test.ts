import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { getFloorAdmin } from "@/features/floor/server/service";
import { createOrder, listTables } from "./service";
import { listRestructureOptions, moveToTable } from "./table-ops";

const stamp = Date.now();
let ctx: TenantContext;
let other: TenantContext;
const businessIds: string[] = [];
const labels = ["T10", "T2", "T1", "T11", "T3", "Bar 2", "Bar 10", "Bar 1"];

beforeAll(async () => {
  const mk = async (name: string) => {
    const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
    const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
    businessIds.push(biz.id);
    const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
    return { userId: user.id, businessId: biz.id, branchId: branch.id, branchIds: [branch.id], role: "OWNER" } as TenantContext;
  };
  ctx = await mk("itest-torder-a");
  other = await mk("itest-torder-b");
  const hall = await db.area.create({ data: { businessId: ctx.businessId, branchId: ctx.branchId, name: "Hall", sortOrder: 1 } });
  const garden = await db.area.create({ data: { businessId: ctx.businessId, branchId: ctx.branchId, name: "Garden", sortOrder: 2 } });
  for (const l of labels) await db.diningTable.create({ data: { businessId: ctx.businessId, branchId: ctx.branchId, areaId: l.startsWith("Bar") ? garden.id : hall.id, label: l } });
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("tables in counting order", () => {
  it("lists tables area by area, T1 T2 T3 T10 T11, not T1 T10 T11 T2", async () => {
    const t = await listTables(ctx);
    expect(t.map((x) => x.label)).toEqual(["T1", "T2", "T3", "T10", "T11", "Bar 1", "Bar 2", "Bar 10"]);
    const admin = await getFloorAdmin(ctx);
    expect(admin.map((a) => a.tables.map((x) => x.label))).toEqual([["T1", "T2", "T3", "T10", "T11"], ["Bar 1", "Bar 2", "Bar 10"]]);
  });

  it("offers the free tables to move to in the same order", async () => {
    const t1 = await db.diningTable.findFirstOrThrow({ where: { businessId: ctx.businessId, label: "T1" } });
    const order = await createOrder(ctx, { type: "DINE_IN", tableId: t1.id, idempotencyKey: `k-${stamp}-a` });
    const opts = await listRestructureOptions(ctx, order.id);
    expect(opts.freeTables.map((x) => x.label)).toEqual(["T2", "T3", "T10", "T11", "Bar 1", "Bar 2", "Bar 10"]);
  });

  it("moves the whole party to a free table, then that table is busy and the old one is free", async () => {
    const order = await db.order.findFirstOrThrow({ where: { businessId: ctx.businessId, status: "OPEN" } });
    const t2 = await db.diningTable.findFirstOrThrow({ where: { businessId: ctx.businessId, label: "T2" } });
    await moveToTable(ctx, order.id, t2.id);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).tableId).toBe(t2.id);
    expect((await db.diningTable.findFirstOrThrow({ where: { businessId: ctx.businessId, label: "T1" } })).state).toBe("FREE");
    // T2 is no longer offered, T1 is.
    expect((await listRestructureOptions(ctx, order.id)).freeTables.map((x) => x.label)).toContain("T1");
    // Another business cannot move it, or move onto a table of ours.
    await expect(moveToTable(other, order.id, t2.id)).rejects.toThrow();
    await expect(moveToTable(ctx, order.id, t2.id)).rejects.toThrow(/already/);
  });
});
