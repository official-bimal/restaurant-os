import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { Prisma } from "@/generated/prisma/client";

/** Menu management. Every query is filtered by ctx.businessId. */

function need(ctx: TenantContext) {
  if (!can(ctx.role, "menu.manage")) throw new DomainError("You do not have permission to change the menu.");
}

function cleanName(value: string, what: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 80) throw new DomainError(`${what} name must be 1 to 80 characters.`);
  return name;
}

/**
 * The optional Nepali name of a dish or category. `undefined` means "leave it as it is", an empty value clears it.
 * Any script is accepted (it is just text), but it is trimmed, control characters are dropped and it is capped at 80.
 */
export function cleanNameNe(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const name = value.replace(/\p{Cc}/gu, " ").trim().replace(/\s+/g, " ");
  if (name.length === 0) return null;
  if (name.length > 80) throw new DomainError("The Nepali name must be 80 characters or fewer.");
  return name;
}

/** Turn a duplicate-name database error into a readable message. */
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


/** Names are unique per business ignoring case, so "Desserts" and "desserts" cannot both exist. */
async function assertNameFree(
  find: (name: string) => Promise<{ id: string } | null>,
  what: string,
  name: string,
  exceptId?: string,
) {
  const clash = await find(name);
  if (clash && clash.id !== exceptId) throw new DomainError(`${what} with that name already exists.`);
}

export interface MenuItemInput {
  categoryId: string;
  stationId: string | null;
  name: string;
  /** Optional Nepali name (undefined keeps what is saved, empty clears it). */
  nameNe?: string | null;
  /** Paisa. */
  price: number;
  prepMinutes: number;
}

function checkItem(input: MenuItemInput): MenuItemInput {
  if (!Number.isInteger(input.price) || input.price < 0 || input.price > 100_000_00) {
    throw new DomainError("Price must be between Rs 0 and Rs 100,000.");
  }
  if (!Number.isInteger(input.prepMinutes) || input.prepMinutes < 1 || input.prepMinutes > 240) {
    throw new DomainError("Preparation time must be 1 to 240 minutes.");
  }
  return { ...input, name: cleanName(input.name, "Item"), nameNe: cleanNameNe(input.nameNe) };
}

export async function getMenuAdmin(ctx: TenantContext) {
  const [categories, stations] = await Promise.all([
    db.menuCategory.findMany({
      where: { businessId: ctx.businessId },
      include: { items: { orderBy: { name: "asc" }, include: { _count: { select: { orderItems: true } }, image: { select: { updatedAt: true } } } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.station.findMany({ where: { businessId: ctx.businessId }, orderBy: { name: "asc" } }),
  ]);
  return { categories, stations };
}

// --- categories ----------------------------------------------------------

export async function createCategory(ctx: TenantContext, rawName: string, rawNameNe?: string | null) {
  need(ctx);
  const name = cleanName(rawName, "Category");
  const nameNe = cleanNameNe(rawNameNe);
  await assertNameFree(
    (n) => db.menuCategory.findFirst({ where: { businessId: ctx.businessId, name: { equals: n, mode: "insensitive" } } }),
    "A category",
    name,
  );
  return unique("A category", () =>
    db.$transaction(async (tx) => {
      const last = await tx.menuCategory.aggregate({
        where: { businessId: ctx.businessId },
        _max: { sortOrder: true },
      });
      const cat = await tx.menuCategory.create({
        data: { businessId: ctx.businessId, name, nameNe: nameNe ?? null, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      });
      await audit(tx, ctx, "menu.category.create", "MenuCategory", cat.id, { name });
      return cat;
    }),
  );
}

export async function renameCategory(ctx: TenantContext, id: string, rawName: string, rawNameNe?: string | null) {
  need(ctx);
  const name = cleanName(rawName, "Category");
  const nameNe = cleanNameNe(rawNameNe);
  const found = await db.menuCategory.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!found) throw new DomainError("Category not found.");
  await assertNameFree(
    (n) => db.menuCategory.findFirst({ where: { businessId: ctx.businessId, name: { equals: n, mode: "insensitive" } } }),
    "A category",
    name,
    id,
  );
  await unique("A category", () =>
    db.$transaction(async (tx) => {
      await tx.menuCategory.update({ where: { businessId_id: { businessId: ctx.businessId, id } }, data: { name, ...(nameNe === undefined ? {} : { nameNe }) } });
      await audit(tx, ctx, "menu.category.rename", "MenuCategory", id, { from: found.name, to: name, nameNe: nameNe ?? undefined });
    }),
  );
}

export async function deleteCategory(ctx: TenantContext, id: string) {
  need(ctx);
  const cat = await db.menuCategory.findFirst({
    where: { id, businessId: ctx.businessId },
    include: { _count: { select: { items: true } } },
  });
  if (!cat) throw new DomainError("Category not found.");
  if (cat._count.items > 0) throw new DomainError("Move or remove the items in this category first.");
  await db.$transaction(async (tx) => {
    await tx.menuCategory.delete({ where: { businessId_id: { businessId: ctx.businessId, id } } });
    await audit(tx, ctx, "menu.category.delete", "MenuCategory", id, { name: cat.name });
  });
}

// --- items ---------------------------------------------------------------

/** Category and station must belong to this business: the browser only sends ids. */
async function assertOwnRefs(ctx: TenantContext, input: MenuItemInput) {
  const cat = await db.menuCategory.findFirst({ where: { id: input.categoryId, businessId: ctx.businessId } });
  if (!cat) throw new DomainError("Category not found.");
  if (input.stationId) {
    const st = await db.station.findFirst({ where: { id: input.stationId, businessId: ctx.businessId } });
    if (!st) throw new DomainError("Station not found.");
  }
}

export async function createItem(ctx: TenantContext, raw: MenuItemInput) {
  need(ctx);
  const input = checkItem(raw);
  await assertOwnRefs(ctx, input);
  return db.$transaction(async (tx) => {
    const item = await tx.menuItem.create({ data: { businessId: ctx.businessId, ...input } });
    await audit(tx, ctx, "menu.item.create", "MenuItem", item.id, { name: item.name, price: item.price });
    return item;
  });
}

export async function updateItem(ctx: TenantContext, id: string, raw: MenuItemInput) {
  need(ctx);
  const input = checkItem(raw);
  await assertOwnRefs(ctx, input);
  const found = await db.menuItem.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!found) throw new DomainError("Item not found.");
  await db.$transaction(async (tx) => {
    // Past orders keep their own copy of name and price, so history never changes.
    await tx.menuItem.update({ where: { businessId_id: { businessId: ctx.businessId, id } }, data: input });
    await audit(tx, ctx, "menu.item.update", "MenuItem", id, {
      from: { name: found.name, price: found.price },
      to: { name: input.name, price: input.price },
    });
  });
}

export async function setItemAvailable(ctx: TenantContext, id: string, available: boolean) {
  need(ctx);
  const found = await db.menuItem.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!found) throw new DomainError("Item not found.");
  await db.$transaction(async (tx) => {
    await tx.menuItem.update({ where: { businessId_id: { businessId: ctx.businessId, id } }, data: { available } });
    await audit(tx, ctx, "menu.item.availability", "MenuItem", id, { available });
  });
}

export async function deleteItem(ctx: TenantContext, id: string) {
  need(ctx);
  const item = await db.menuItem.findFirst({
    where: { id, businessId: ctx.businessId },
    include: { _count: { select: { orderItems: true } } },
  });
  if (!item) throw new DomainError("Item not found.");
  if (item._count.orderItems > 0) {
    throw new DomainError("This item has been ordered before, so it cannot be deleted. Mark it unavailable instead.");
  }
  await db.$transaction(async (tx) => {
    await tx.menuItem.delete({ where: { businessId_id: { businessId: ctx.businessId, id } } });
    await audit(tx, ctx, "menu.item.delete", "MenuItem", id, { name: item.name });
  });
}

// --- stations ------------------------------------------------------------

export async function createStation(ctx: TenantContext, rawName: string) {
  need(ctx);
  const name = cleanName(rawName, "Station");
  await assertNameFree(
    (n) => db.station.findFirst({ where: { businessId: ctx.businessId, name: { equals: n, mode: "insensitive" } } }),
    "A station",
    name,
  );
  return unique("A station", () =>
    db.$transaction(async (tx) => {
      const st = await tx.station.create({ data: { businessId: ctx.businessId, name } });
      await audit(tx, ctx, "menu.station.create", "Station", st.id, { name });
      return st;
    }),
  );
}

export async function deleteStation(ctx: TenantContext, id: string) {
  need(ctx);
  const st = await db.station.findFirst({
    where: { id, businessId: ctx.businessId },
    include: { _count: { select: { items: true } } },
  });
  if (!st) throw new DomainError("Station not found.");
  if (st._count.items > 0) throw new DomainError("Some dishes still send tickets to this station. Reassign them first.");
  await db.$transaction(async (tx) => {
    await tx.station.delete({ where: { businessId_id: { businessId: ctx.businessId, id } } });
    await audit(tx, ctx, "menu.station.delete", "Station", id, { name: st.name });
  });
}
