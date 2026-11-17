import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";

/**
 * The menu per branch. Dishes, categories, stations, recipes and the shared price live once for the business; a branch can
 * set its own price for a dish, switch a dish or a whole category off for itself, send a dish to a different kitchen
 * station, and set its own price (or switch off) for an add-on choice, without touching the others. No override means
 * "same as the shared menu". The dish's own availability switch (Menu page) still hides it everywhere.
 */

type Db = Tx | typeof db;
export interface BranchOverride {
  price: number | null;
  available: boolean;
  stationId?: string | null;
}

/** One branch's overrides, keyed by dish. */
export async function branchMenuOverrides(client: Db, businessId: string, branchId: string): Promise<Map<string, BranchOverride>> {
  const rows = await client.branchMenuItem.findMany({ where: { businessId, branchId }, select: { menuItemId: true, price: true, available: true, stationId: true } });
  return new Map(rows.map((r) => [r.menuItemId, { price: r.price, available: r.available, stationId: r.stationId }]));
}

/** The categories this branch does not show. */
export async function hiddenCategoryIds(client: Db, businessId: string, branchId: string): Promise<Set<string>> {
  const rows = await client.branchCategoryHide.findMany({ where: { businessId, branchId }, select: { categoryId: true } });
  return new Set(rows.map((r) => r.categoryId));
}

/** The dishes of the categories this branch hides, so "can this dish be ordered here" is one set lookup. */
export async function hiddenDishIds(client: Db, businessId: string, branchId: string): Promise<Set<string>> {
  const hidden = await hiddenCategoryIds(client, businessId, branchId);
  if (hidden.size === 0) return new Set();
  const dishes = await client.menuItem.findMany({ where: { businessId, categoryId: { in: [...hidden] } }, select: { id: true } });
  return new Set(dishes.map((d) => d.id));
}

/** What a dish costs and whether it can be ordered in a branch, given the shared dish, that branch's override and its hidden categories. */
export function effectiveItem(
  item: { price: number; available: boolean; categoryId?: string },
  override?: BranchOverride,
  hiddenCategories?: Set<string>,
) {
  return {
    price: override?.price ?? item.price,
    available: item.available && (override?.available ?? true) && !(item.categoryId && hiddenCategories?.has(item.categoryId)),
  };
}

function need(ctx: TenantContext) {
  if (!can(ctx.role, "menu.manage")) throw new DomainError("You do not have permission to change the menu.");
}

/** Every dish with the shared price and availability next to this branch's own, for the branch menu page. */
export async function getBranchMenuAdmin(ctx: TenantContext) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const [categories, overrides, hidden, stations] = await Promise.all([
    db.menuCategory.findMany({
      where: { businessId },
      include: { items: { orderBy: { name: "asc" }, include: { station: { select: { name: true } } } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    branchMenuOverrides(db, businessId, branchId),
    hiddenCategoryIds(db, businessId, branchId),
    db.station.findMany({ where: { businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return {
    stations,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      hiddenHere: hidden.has(c.id),
      items: c.items.map((i) => {
        const o = overrides.get(i.id);
        return {
          id: i.id,
          name: i.name,
          basePrice: i.price,
          sharedAvailable: i.available,
          sharedStation: i.station?.name ?? null,
          branchPrice: o?.price ?? null,
          branchAvailable: o?.available ?? true,
          branchStationId: o?.stationId ?? null,
          effective: effectiveItem({ ...i, categoryId: c.id }, o, hidden),
        };
      }),
    })),
  };
}

/**
 * Set how this branch differs for a dish: its own price (null = the shared price), whether it is offered here, and
 * optionally a different kitchen station (null = the dish's own; leave `stationId` out to keep what is set). Setting
 * everything back to the defaults removes the override, so the branch simply follows the shared menu again.
 */
export async function setBranchMenuItem(
  ctx: TenantContext,
  menuItemId: string,
  input: { price: number | null; available: boolean; stationId?: string | null },
) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  if (input.price !== null && (!Number.isInteger(input.price) || input.price < 0 || input.price > 100_000_00)) {
    throw new DomainError("Price must be between Rs 0 and Rs 100,000.");
  }
  await db.$transaction(async (tx) => {
    const dish = await tx.menuItem.findFirst({ where: { id: menuItemId, businessId } });
    if (!dish) throw new DomainError("Dish not found.");
    const existing = await tx.branchMenuItem.findUnique({ where: { branchId_menuItemId: { branchId, menuItemId } } });
    let stationId = input.stationId === undefined ? (existing?.stationId ?? null) : input.stationId;
    if (stationId) {
      const st = await tx.station.findFirst({ where: { id: stationId, businessId } });
      if (!st) throw new DomainError("Station not found.");
      if (stationId === dish.stationId) stationId = null; // same as the dish's own: not an override
    }
    const price = input.price === null || input.price === dish.price ? null : input.price;
    if (price === null && input.available && !stationId) {
      await tx.branchMenuItem.deleteMany({ where: { businessId, branchId, menuItemId } });
    } else {
      await tx.branchMenuItem.upsert({
        where: { branchId_menuItemId: { branchId, menuItemId } },
        create: { businessId, branchId, menuItemId, price, available: input.available, stationId },
        update: { price, available: input.available, stationId },
      });
    }
    await audit(tx, ctx, "menu.branchItem", "MenuItem", menuItemId, { dish: dish.name, branchId, price: input.price, available: input.available, stationId });
  });
}

/** Show or hide a whole category (and every dish in it) at this branch only. */
export async function setCategoryHiddenHere(ctx: TenantContext, categoryId: string, hidden: boolean) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const cat = await tx.menuCategory.findFirst({ where: { id: categoryId, businessId } });
    if (!cat) throw new DomainError("Category not found.");
    if (hidden) {
      await tx.branchCategoryHide.createMany({ data: [{ businessId, branchId, categoryId }], skipDuplicates: true });
    } else {
      await tx.branchCategoryHide.deleteMany({ where: { businessId, branchId, categoryId } });
    }
    await audit(tx, ctx, hidden ? "menu.categoryHide" : "menu.categoryShow", "MenuCategory", categoryId, { name: cat.name, branchId });
  });
}

// --- add-on choices per branch ----------------------------------------------------------------

/** This branch's overrides for add-on choices, keyed by choice. */
export async function branchAddOnOverrides(client: Db, businessId: string, branchId: string): Promise<Map<string, { price: number | null; available: boolean }>> {
  const rows = await client.branchAddOn.findMany({ where: { businessId, branchId }, select: { addOnId: true, price: true, available: true } });
  return new Map(rows.map((r) => [r.addOnId, { price: r.price, available: r.available }]));
}

/** Every active add-on choice with the shared price next to this branch's own, grouped for the branch menu page. */
export async function getBranchAddOnAdmin(ctx: TenantContext) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const [groups, overrides] = await Promise.all([
    db.addOnGroup.findMany({
      where: { businessId, active: true },
      orderBy: { name: "asc" },
      include: { addOns: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
    }),
    branchAddOnOverrides(db, businessId, branchId),
  ]);
  return groups
    .filter((g) => g.addOns.length > 0)
    .map((g) => ({
      id: g.id,
      name: g.name,
      choices: g.addOns.map((a) => {
        const o = overrides.get(a.id);
        return { id: a.id, name: a.name, basePrice: a.price, branchPrice: o?.price ?? null, branchAvailable: o?.available ?? true };
      }),
    }));
}

/** This branch's own extra price for an add-on choice (null = shared) and whether it is offered here. */
export async function setBranchAddOn(ctx: TenantContext, addOnId: string, input: { price: number | null; available: boolean }) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  if (input.price !== null && (!Number.isInteger(input.price) || input.price < 0 || input.price > 10_000_000)) {
    throw new DomainError("Enter an extra price of Rs 0 or more.");
  }
  await db.$transaction(async (tx) => {
    const a = await tx.addOn.findFirst({ where: { id: addOnId, businessId, active: true } });
    if (!a) throw new DomainError("Choice not found.");
    const price = input.price === null || input.price === a.price ? null : input.price;
    if (price === null && input.available) {
      await tx.branchAddOn.deleteMany({ where: { businessId, branchId, addOnId } });
    } else {
      await tx.branchAddOn.upsert({
        where: { branchId_addOnId: { branchId, addOnId } },
        create: { businessId, branchId, addOnId, price, available: input.available },
        update: { price, available: input.available },
      });
    }
    await audit(tx, ctx, "menu.branchAddOn", "AddOn", addOnId, { name: a.name, branchId, price: input.price, available: input.available });
  });
}
