import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { scope } from "@/server/branch";
import { Prisma } from "@/generated/prisma/client";
import { randomBytes } from "node:crypto";
import { clampPos } from "@/lib/floor-plan";
import { closeTableSittingsInTx } from "@/features/guest/server/service";

/** Areas and tables. Every query is filtered by ctx.businessId. */

function need(ctx: TenantContext) {
  if (!can(ctx, "floor.manage")) throw new DomainError("You do not have permission to change tables.");
}

function cleanName(value: string, what: string, max = 40): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > max) throw new DomainError(`${what} must be 1 to ${max} characters.`);
  return name;
}

async function unique<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DomainError(`${what} with that name already exists.`);
    }
    throw e;
  }
}


/** Labels are unique per business ignoring case ("t1" and "T1" are the same table). */
async function assertNameFree(
  find: (name: string) => Promise<{ id: string } | null>,
  what: string,
  name: string,
  exceptId?: string,
) {
  const clash = await find(name);
  if (clash && clash.id !== exceptId) throw new DomainError(`${what} with that name already exists.`);
}

export async function getFloorAdmin(ctx: TenantContext) {
  return db.area.findMany({
    where: scope(ctx),
    include: {
      tables: {
        orderBy: { label: "asc" },
        include: { _count: { select: { orders: true, sessions: true } } },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function createArea(ctx: TenantContext, rawName: string) {
  need(ctx);
  const name = cleanName(rawName, "Area name");
  await assertNameFree(
    (n) => db.area.findFirst({ where: { ...scope(ctx), name: { equals: n, mode: "insensitive" } } }),
    "An area",
    name,
  );
  return unique("An area", () =>
    db.$transaction(async (tx) => {
      const last = await tx.area.aggregate({ where: scope(ctx), _max: { sortOrder: true } });
      const area = await tx.area.create({
        data: { ...scope(ctx), name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      });
      await audit(tx, ctx, "floor.area.create", "Area", area.id, { name });
      return area;
    }),
  );
}

export async function renameArea(ctx: TenantContext, id: string, rawName: string) {
  need(ctx);
  const name = cleanName(rawName, "Area name");
  const area = await db.area.findFirst({ where: { id, ...scope(ctx) } });
  if (!area) throw new DomainError("Area not found.");
  await assertNameFree(
    (n) => db.area.findFirst({ where: { ...scope(ctx), name: { equals: n, mode: "insensitive" } } }),
    "An area",
    name,
    id,
  );
  await unique("An area", () =>
    db.$transaction(async (tx) => {
      await tx.area.update({ where: { businessId_id: { businessId: ctx.businessId, id } }, data: { name } });
      await audit(tx, ctx, "floor.area.rename", "Area", id, { from: area.name, to: name });
    }),
  );
}

export async function deleteArea(ctx: TenantContext, id: string) {
  need(ctx);
  const area = await db.area.findFirst({
    where: { id, ...scope(ctx) },
    include: { _count: { select: { tables: true } } },
  });
  if (!area) throw new DomainError("Area not found.");
  if (area._count.tables > 0) throw new DomainError("Remove or move the tables in this area first.");
  await db.$transaction(async (tx) => {
    await tx.area.delete({ where: { businessId_id: { businessId: ctx.businessId, id } } });
    await audit(tx, ctx, "floor.area.delete", "Area", id, { name: area.name });
  });
}

export interface TableInput {
  areaId: string;
  label: string;
  capacity: number;
}

function checkTable(input: TableInput): TableInput {
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 50) {
    throw new DomainError("Seats must be between 1 and 50.");
  }
  return { ...input, label: cleanName(input.label, "Table label", 20) };
}

async function assertOwnArea(ctx: TenantContext, areaId: string) {
  const area = await db.area.findFirst({ where: { id: areaId, ...scope(ctx) } });
  if (!area) throw new DomainError("Area not found.");
}

export async function createTable(ctx: TenantContext, raw: TableInput) {
  need(ctx);
  const input = checkTable(raw);
  await assertOwnArea(ctx, input.areaId);
  await assertNameFree(
    (n) => db.diningTable.findFirst({ where: { ...scope(ctx), label: { equals: n, mode: "insensitive" } } }),
    "A table",
    input.label,
  );
  return unique("A table", () =>
    db.$transaction(async (tx) => {
      const table = await tx.diningTable.create({ data: { ...scope(ctx), ...input } });
      await audit(tx, ctx, "floor.table.create", "DiningTable", table.id, { label: table.label });
      return table;
    }),
  );
}

export async function updateTable(ctx: TenantContext, id: string, raw: TableInput) {
  need(ctx);
  const input = checkTable(raw);
  await assertOwnArea(ctx, input.areaId);
  const table = await db.diningTable.findFirst({ where: { id, ...scope(ctx) } });
  if (!table) throw new DomainError("Table not found.");
  await assertNameFree(
    (n) => db.diningTable.findFirst({ where: { ...scope(ctx), label: { equals: n, mode: "insensitive" } } }),
    "A table",
    input.label,
    id,
  );
  await unique("A table", () =>
    db.$transaction(async (tx) => {
      await tx.diningTable.update({ where: { businessId_id: { businessId: ctx.businessId, id } }, data: input });
      await audit(tx, ctx, "floor.table.update", "DiningTable", id, { from: table.label, to: input.label });
    }),
  );
}

export async function deleteTable(ctx: TenantContext, id: string) {
  need(ctx);
  const table = await db.diningTable.findFirst({
    where: { id, ...scope(ctx) },
    include: { _count: { select: { orders: true, sessions: true } } },
  });
  if (!table) throw new DomainError("Table not found.");
  if (table.state !== "FREE") throw new DomainError("This table is in use right now.");
  if (table._count.orders > 0 || table._count.sessions > 0) {
    throw new DomainError("This table has order history, so it cannot be deleted.");
  }
  await db.$transaction(async (tx) => {
    await tx.diningTable.delete({ where: { businessId_id: { businessId: ctx.businessId, id } } });
    await audit(tx, ctx, "floor.table.delete", "DiningTable", id, { label: table.label });
  });
}

// --- guest ordering ------------------------------------------------------

export async function getGuestSettings(ctx: TenantContext) {
  need(ctx);
  return db.business.findUniqueOrThrow({
    where: { id: ctx.businessId },
    select: { guestOrderingEnabled: true, requireOrderApproval: true, guestBestSellers: true },
  });
}

export async function setGuestSettings(ctx: TenantContext, input: { enabled: boolean; requireApproval: boolean; bestSellers?: boolean }) {
  need(ctx);
  await db.$transaction(async (tx) => {
    await tx.business.update({
      where: { id: ctx.businessId },
      data: {
        guestOrderingEnabled: input.enabled,
        requireOrderApproval: input.requireApproval,
        ...(input.bestSellers === undefined ? {} : { guestBestSellers: input.bestSellers }),
      },
    });
    await audit(tx, ctx, "floor.guestSettings", "Business", ctx.businessId, input);
  });
}

/** Print a new QR if the old one leaked. The old one stops working and any open sitting ends. */
export async function resetTableQr(ctx: TenantContext, id: string) {
  need(ctx);
  const table = await db.diningTable.findFirst({ where: { id, ...scope(ctx) } });
  if (!table) throw new DomainError("Table not found.");
  await db.$transaction(async (tx) => {
    await tx.diningTable.update({
      where: { businessId_id: { businessId: ctx.businessId, id } },
      data: { publicToken: randomBytes(32).toString("hex") },
    });
    await closeTableSittingsInTx(tx, ctx.businessId, id, { reason: "QR_RESET" });
    await audit(tx, ctx, "floor.qrReset", "DiningTable", id, { label: table.label });
  });
}

// --- floor plan ------------------------------------------------------------------

/**
 * Saves where the tables of one area sit on its floor plan. Positions are thousandths of the plan's width and height. `null` clears the plan,
 * so the area goes back to the tidy rows. Tables not listed keep their place.
 */
export async function saveFloorPlan(ctx: TenantContext, areaId: string, positions: { tableId: string; x: number; y: number }[] | null) {
  need(ctx);
  if (positions && positions.length > 200) throw new DomainError("That is too many tables for one plan.");
  await db.$transaction(async (tx) => {
    const area = await tx.area.findFirst({ where: { id: areaId, ...scope(ctx) } });
    if (!area) throw new DomainError("Area not found.");
    if (positions === null) {
      await tx.diningTable.updateMany({ where: { businessId: ctx.businessId, areaId }, data: { posX: null, posY: null } });
      await audit(tx, ctx, "floor.planReset", "Area", areaId, { name: area.name });
      return;
    }
    const ids = positions.map((p) => p.tableId);
    const mine = await tx.diningTable.findMany({ where: { businessId: ctx.businessId, areaId, id: { in: ids } }, select: { id: true } });
    if (mine.length !== new Set(ids).size) throw new DomainError("One of those tables is not in this area.");
    for (const p of positions) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new DomainError("Positions must be numbers.");
      await tx.diningTable.update({
        where: { businessId_id: { businessId: ctx.businessId, id: p.tableId } },
        data: { posX: clampPos(p.x), posY: clampPos(p.y) },
      });
    }
    await audit(tx, ctx, "floor.planSave", "Area", areaId, { name: area.name, tables: positions.length });
  });
}
