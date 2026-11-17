import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { Prisma } from "@/generated/prisma/client";
import { validateAddOnPrice } from "@/features/menu/addons";
import { groupRulesForMenu } from "@/features/menu/server/pricing";

/** Add-on groups and choices ("Size", "Extras"). Business-wide; every query is filtered by businessId. */

function need(ctx: TenantContext) {
  if (!can(ctx.role, "menu.manage")) throw new DomainError("You do not have permission to change the menu.");
}

function cleanName(value: string, what: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 60) throw new DomainError(`${what} name must be 1 to 60 characters.`);
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

export async function listAddOnGroups(ctx: TenantContext) {
  need(ctx);
  return db.addOnGroup.findMany({
    where: { businessId: ctx.businessId, active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      addOns: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { stock: true } },
      items: { select: { menuItemId: true } },
    },
  });
}

export async function createGroup(ctx: TenantContext, input: { name: string; required: boolean; multiple: boolean }) {
  need(ctx);
  const name = cleanName(input.name, "Group");
  return unique("A group", () =>
    db.$transaction(async (tx) => {
      const g = await tx.addOnGroup.create({
        data: { businessId: ctx.businessId, name, required: input.required, multiple: input.multiple },
      });
      await audit(tx, ctx, "addon.groupCreate", "AddOnGroup", g.id, { name });
      return g;
    }),
  );
}

export async function updateGroup(ctx: TenantContext, id: string, input: { name: string; required: boolean; multiple: boolean }) {
  need(ctx);
  const name = cleanName(input.name, "Group");
  await unique("A group", () =>
    db.$transaction(async (tx) => {
      const r = await tx.addOnGroup.updateMany({
        where: { id, businessId: ctx.businessId, active: true },
        data: { name, required: input.required, multiple: input.multiple },
      });
      if (r.count === 0) throw new DomainError("Group not found.");
      await audit(tx, ctx, "addon.groupUpdate", "AddOnGroup", id, { name });
    }),
  );
}

/** Groups are switched off, not deleted: old orders keep their copies of what was chosen. */
export async function archiveGroup(ctx: TenantContext, id: string) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const r = await tx.addOnGroup.updateMany({ where: { id, businessId: ctx.businessId, active: true }, data: { active: false } });
    if (r.count === 0) throw new DomainError("Group not found.");
    await tx.menuItemAddOnGroup.deleteMany({ where: { businessId: ctx.businessId, groupId: id } });
    await audit(tx, ctx, "addon.groupArchive", "AddOnGroup", id);
  });
}

export async function createAddOn(ctx: TenantContext, groupId: string, input: { name: string; price: number }) {
  need(ctx);
  const name = cleanName(input.name, "Choice");
  validateAddOnPrice(input.price);
  return unique("A choice", () =>
    db.$transaction(async (tx) => {
      const group = await tx.addOnGroup.findFirst({ where: { id: groupId, businessId: ctx.businessId, active: true } });
      if (!group) throw new DomainError("Group not found.");
      const a = await tx.addOn.create({ data: { businessId: ctx.businessId, groupId, name, price: input.price } });
      await audit(tx, ctx, "addon.create", "AddOn", a.id, { group: group.name, name, price: input.price });
      return a;
    }),
  );
}

export async function updateAddOn(ctx: TenantContext, id: string, input: { name: string; price: number }) {
  need(ctx);
  const name = cleanName(input.name, "Choice");
  validateAddOnPrice(input.price);
  await unique("A choice", () =>
    db.$transaction(async (tx) => {
      const r = await tx.addOn.updateMany({
        where: { id, businessId: ctx.businessId, active: true },
        data: { name, price: input.price },
      });
      if (r.count === 0) throw new DomainError("Choice not found.");
      await audit(tx, ctx, "addon.update", "AddOn", id, { name, price: input.price });
    }),
  );
}

export async function archiveAddOn(ctx: TenantContext, id: string) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const r = await tx.addOn.updateMany({ where: { id, businessId: ctx.businessId, active: true }, data: { active: false } });
    if (r.count === 0) throw new DomainError("Choice not found.");
    await audit(tx, ctx, "addon.archive", "AddOn", id);
  });
}

/** Which dishes use this group. Replaces the previous list. */
export async function setGroupItems(ctx: TenantContext, groupId: string, menuItemIds: string[]) {
  need(ctx);
  const ids = [...new Set(menuItemIds)];
  await db.$transaction(async (tx) => {
    const group = await tx.addOnGroup.findFirst({ where: { id: groupId, businessId: ctx.businessId, active: true } });
    if (!group) throw new DomainError("Group not found.");
    if (ids.length) {
      const valid = await tx.menuItem.count({ where: { businessId: ctx.businessId, id: { in: ids } } });
      if (valid !== ids.length) throw new DomainError("One of those dishes was not found.");
    }
    await tx.menuItemAddOnGroup.deleteMany({ where: { businessId: ctx.businessId, groupId } });
    if (ids.length) {
      await tx.menuItemAddOnGroup.createMany({ data: ids.map((menuItemId) => ({ businessId: ctx.businessId, groupId, menuItemId })) });
    }
    await audit(tx, ctx, "addon.assign", "AddOnGroup", groupId, { dishes: ids.length });
  });
}

/** What a waiter can choose from for the dishes on the order screen: dish id to its active groups. */
export async function addOnsForMenu(ctx: TenantContext) {
  return groupRulesForMenu(db, ctx.businessId, ctx.branchId);
}

/**
 * Stock one add-on uses each time it is chosen. Replaces the previous list. Quantities are in the
 * stock item's own unit (g, ml, piece); it is taken off when the bill is paid, like a recipe.
 */
export async function setAddOnStock(ctx: TenantContext, addOnId: string, lines: { stockItemId: string; quantity: number }[]) {
  need(ctx);
  const clean = new Map<string, number>();
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 1_000_000) {
      throw new DomainError("Enter how much stock it uses as a whole number, 1 or more.");
    }
    clean.set(l.stockItemId, l.quantity);
  }
  await db.$transaction(async (tx) => {
    const addOn = await tx.addOn.findFirst({ where: { id: addOnId, businessId: ctx.businessId, active: true } });
    if (!addOn) throw new DomainError("Choice not found.");
    if (clean.size) {
      const valid = await tx.stockItem.count({ where: { businessId: ctx.businessId, active: true, id: { in: [...clean.keys()] } } });
      if (valid !== clean.size) throw new DomainError("One of those stock items was not found.");
    }
    await tx.addOnStock.deleteMany({ where: { businessId: ctx.businessId, addOnId } });
    if (clean.size) {
      await tx.addOnStock.createMany({
        data: [...clean].map(([stockItemId, quantity]) => ({ businessId: ctx.businessId, addOnId, stockItemId, quantity })),
      });
    }
    await audit(tx, ctx, "addon.stock", "AddOn", addOnId, { items: clean.size });
  });
}
