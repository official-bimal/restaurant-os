import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { Prisma } from "@/generated/prisma/client";
import { scope } from "@/server/branch";
import { localParts, parseTime, pickActiveSet } from "@/features/menu/menu-sets";

/**
 * Menu sets (Breakfast, Lunch...) are shared by the business, but which one is on, and the weekly
 * schedule, belong to each branch. Every query is filtered by businessId. With no set active in a
 * branch, its whole menu can be ordered.
 */

type Db = Tx | typeof db;

function need(ctx: TenantContext) {
  if (!can(ctx, "menu.manage")) throw new DomainError("You do not have permission to change the menu.");
}

/**
 * The dishes that can be ordered right now: a Set of menu item ids, or null when the whole menu
 * is open. Used by the order screen, the guest menu and addItem so they always agree.
 */
export async function orderableItemIds(
  client: Db,
  businessId: string,
  branchId: string,
  now = new Date(),
): Promise<Set<string> | null> {
  const [business, branch] = await Promise.all([
    client.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } }),
    client.branch.findUniqueOrThrow({ where: { businessId_id: { businessId, id: branchId } }, select: { activeMenuSetId: true } }),
  ]);
  const schedules = branch.activeMenuSetId
    ? []
    : await client.menuSchedule.findMany({
        where: { businessId, branchId },
        select: { menuSetId: true, dayOfWeek: true, startMinute: true, endMinute: true },
      });
  const setId = pickActiveSet(branch.activeMenuSetId, schedules, localParts(now, business.timezone));
  if (!setId) return null;
  const rows = await client.menuSetItem.findMany({ where: { businessId, menuSetId: setId }, select: { menuItemId: true } });
  return new Set(rows.map((r) => r.menuItemId));
}

export async function getMenuSetOverview(ctx: TenantContext) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const [branch, sets, schedules] = await Promise.all([
    db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId, id: branchId } }, select: { name: true, activeMenuSetId: true } }),
    db.menuSet.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { name: "asc" },
      include: { items: { select: { menuItemId: true } } },
    }),
    db.menuSchedule.findMany({
      where: { businessId, branchId },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
      include: { menuSet: { select: { name: true } } },
    }),
  ]);
  const active = await orderableItemIds(db, businessId, branchId);
  return { branchName: branch.name, manualId: branch.activeMenuSetId, sets, schedules, showingAll: active === null };
}

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 60) throw new DomainError("Menu set name must be 1 to 60 characters.");
  return name;
}

export async function createMenuSet(ctx: TenantContext, name: string) {
  need(ctx);
  const clean = cleanName(name);
  try {
    return await db.$transaction(async (tx) => {
      const s = await tx.menuSet.create({ data: { businessId: ctx.businessId, name: clean } });
      await audit(tx, ctx, "menuSet.create", "MenuSet", s.id, { name: clean });
      return s;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DomainError("A menu set with that name already exists.");
    }
    throw e;
  }
}

/** Deleting a set removes its schedule rows in every branch; any branch that had it hand-picked goes back to following its schedule. */
export async function deleteMenuSet(ctx: TenantContext, id: string) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const set = await tx.menuSet.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!set) throw new DomainError("Menu set not found.");
    await tx.branch.updateMany({ where: { businessId: ctx.businessId, activeMenuSetId: id }, data: { activeMenuSetId: null } });
    await tx.menuSet.delete({ where: { businessId_id: { businessId: ctx.businessId, id } } });
    await audit(tx, ctx, "menuSet.delete", "MenuSet", id, { name: set.name });
  });
}

export async function setMenuSetItems(ctx: TenantContext, id: string, menuItemIds: string[]) {
  need(ctx);
  const ids = [...new Set(menuItemIds)];
  await db.$transaction(async (tx) => {
    const set = await tx.menuSet.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!set) throw new DomainError("Menu set not found.");
    if (ids.length) {
      const valid = await tx.menuItem.count({ where: { businessId: ctx.businessId, id: { in: ids } } });
      if (valid !== ids.length) throw new DomainError("One of those dishes was not found.");
    }
    await tx.menuSetItem.deleteMany({ where: { businessId: ctx.businessId, menuSetId: id } });
    if (ids.length) await tx.menuSetItem.createMany({ data: ids.map((menuItemId) => ({ businessId: ctx.businessId, menuSetId: id, menuItemId })) });
    await audit(tx, ctx, "menuSet.items", "MenuSet", id, { dishes: ids.length });
  });
}

/** Pick a set by hand for the current branch (null: follow its schedule, or the whole menu when none applies). */
export async function setActiveMenuSet(ctx: TenantContext, id: string | null) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    if (id) {
      const set = await tx.menuSet.findFirst({ where: { id, businessId: ctx.businessId } });
      if (!set) throw new DomainError("Menu set not found.");
    }
    await tx.branch.update({ where: { businessId_id: { businessId, id: branchId } }, data: { activeMenuSetId: id } });
    await audit(tx, ctx, "menuSet.activate", "MenuSet", id ?? "none", { branchId });
  });
}

export async function addSchedule(
  ctx: TenantContext,
  input: { menuSetId: string; dayOfWeek: number; start: string; end: string },
) {
  need(ctx);
  const { branchId } = scope(ctx);
  const startMinute = parseTime(input.start);
  const endMinute = parseTime(input.end);
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) throw new DomainError("Choose a day.");
  if (startMinute === null || endMinute === null) throw new DomainError("Enter times like 07:30.");
  if (endMinute <= startMinute) throw new DomainError("The end time must be after the start time.");

  return db.$transaction(async (tx) => {
    const set = await tx.menuSet.findFirst({ where: { id: input.menuSetId, businessId: ctx.businessId } });
    if (!set) throw new DomainError("Menu set not found.");
    // Two sets cannot claim the same time in a branch, or nobody could say which one is on.
    const clash = await tx.menuSchedule.findFirst({
      where: { businessId: ctx.businessId, branchId, dayOfWeek: input.dayOfWeek, startMinute: { lt: endMinute }, endMinute: { gt: startMinute } },
      include: { menuSet: { select: { name: true } } },
    });
    if (clash) throw new DomainError(`That overlaps ${clash.menuSet.name} on the same day.`);
    const row = await tx.menuSchedule.create({
      data: { businessId: ctx.businessId, branchId, menuSetId: set.id, dayOfWeek: input.dayOfWeek, startMinute, endMinute },
    });
    await audit(tx, ctx, "menuSet.schedule", "MenuSet", set.id, { dayOfWeek: input.dayOfWeek, start: input.start, end: input.end });
    return row;
  });
}

export async function removeSchedule(ctx: TenantContext, id: string) {
  need(ctx);
  const { branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const r = await tx.menuSchedule.deleteMany({ where: { id, businessId: ctx.businessId, branchId } });
    if (r.count === 0) throw new DomainError("Schedule not found.");
    await audit(tx, ctx, "menuSet.unschedule", "MenuSchedule", id);
  });
}
