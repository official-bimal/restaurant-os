import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can, type Permission } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { scope } from "@/server/branch";
import { costOf, isUnit, stockStatus, weightedAverageCost } from "@/features/stock/stock";
import { activeLevelFor, ensureLevels, levelFor } from "./levels";

/**
 * Stock items, purchases, waste, counts, transfers and recipes. Every query is filtered by businessId.
 * The item (name, unit) and its recipes are shared by the business; what is on the shelf, the reorder level and the average
 * cost are per branch, and everything here works on the branch the person is working in. Quantities are whole numbers of a
 * base unit (g, ml, piece); money is integer paisa.
 */

function need(ctx: TenantContext, permission: Permission) {
  if (!can(ctx.role, permission)) throw new DomainError("You do not have permission to do that.");
}

const MAX_QTY = 1_000_000_000;
const MAX_PAISA = 100_000_000_000;

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 80) throw new DomainError("Name must be 1 to 80 characters.");
  return name;
}

function wholeQty(value: number, what = "Quantity"): number {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_QTY) throw new DomainError(`${what} must be a whole number above zero.`);
  return value;
}

function cleanReason(value: string): string {
  const r = value.trim().replace(/\s+/g, " ");
  if (r.length < 3) throw new DomainError("Give a reason (a few words).");
  if (r.length > 200) throw new DomainError("The reason is too long (200 characters at most).");
  return r;
}

// --- items -------------------------------------------------------------------

/** The items with this branch's quantity, reorder level and average cost. */
export async function listStock(ctx: TenantContext) {
  need(ctx, "stock.view");
  const { businessId, branchId } = scope(ctx);
  await ensureLevels(db, businessId, branchId);
  const levels = await db.branchStock.findMany({
    where: { businessId, branchId, active: true, stockItem: { active: true } },
    include: { stockItem: true },
    orderBy: { stockItem: { name: "asc" } },
  });
  return levels.map((l) => ({
    ...l.stockItem,
    quantity: l.quantity,
    reorderLevel: l.reorderLevel,
    costMilli: l.costMilli,
    status: stockStatus(l.quantity, l.reorderLevel),
  }));
}

export async function lowStockCount(ctx: TenantContext): Promise<number> {
  if (!can(ctx.role, "stock.view")) return 0;
  const levels = await db.branchStock.findMany({
    where: { businessId: ctx.businessId, branchId: ctx.branchId, active: true, stockItem: { active: true } },
    select: { quantity: true, reorderLevel: true },
  });
  return levels.filter((l) => stockStatus(l.quantity, l.reorderLevel) !== "OK").length;
}

/** Items this branch has switched off, so they can be switched back on. */
export async function listNotStockedHere(ctx: TenantContext) {
  need(ctx, "stock.view");
  const { businessId, branchId } = scope(ctx);
  const levels = await db.branchStock.findMany({
    where: { businessId, branchId, active: false, stockItem: { active: true } },
    include: { stockItem: { select: { id: true, name: true, unit: true } } },
    orderBy: { stockItem: { name: "asc" } },
  });
  return levels.map((l) => ({ ...l.stockItem, quantity: l.quantity }));
}

/**
 * Switch an item on or off for the branch you are working in. Off: it disappears from this branch's lists, alerts,
 * reorder suggestions and sales deductions (other branches are not affected). It must be at zero here and nothing may be
 * on its way here, so no stock is left unaccounted for.
 */
export async function setStockedHere(ctx: TenantContext, stockItemId: string, stocked: boolean) {
  need(ctx, "stock.manage");
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const item = await tx.stockItem.findFirst({ where: { id: stockItemId, businessId, active: true } });
    if (!item) throw new DomainError("Stock item not found.");
    const level = await levelFor(tx, businessId, branchId, item.id);
    if (!stocked) {
      if (level.quantity !== 0) throw new DomainError(`There is still ${level.quantity.toLocaleString("en-US")} ${item.unit} of ${item.name} here. Send it to another branch or count it down to zero first.`);
      const coming = await tx.stockTransfer.count({ where: { businessId, toBranchId: branchId, stockItemId: item.id, status: "IN_TRANSIT" } });
      if (coming > 0) throw new DomainError(`Some ${item.name} is on its way here. Receive or cancel it first.`);
    }
    await tx.branchStock.update({ where: { branchId_stockItemId: { branchId, stockItemId: item.id } }, data: { active: stocked } });
    await audit(tx, ctx, stocked ? "stock.stockedHere" : "stock.notStockedHere", "StockItem", item.id, { name: item.name, branchId });
  });
}

function checkReorder(level: number) {
  if (!Number.isInteger(level) || level < 0 || level > MAX_QTY) {
    throw new DomainError("The reorder level must be a whole number, zero or more.");
  }
}

/** A new item appears in every branch; the reorder level given is the starting level in each (change it per branch later). */
export async function createStockItem(ctx: TenantContext, input: { name: string; unit: string; reorderLevel: number }) {
  need(ctx, "stock.manage");
  const name = cleanName(input.name);
  if (!isUnit(input.unit)) throw new DomainError("Choose grams, millilitres or pieces.");
  checkReorder(input.reorderLevel);
  const clash = await db.stockItem.findFirst({
    where: { businessId: ctx.businessId, name: { equals: name, mode: "insensitive" } },
  });
  if (clash) throw new DomainError("A stock item with that name already exists.");
  return db.$transaction(async (tx) => {
    const item = await tx.stockItem.create({ data: { businessId: ctx.businessId, name, unit: input.unit } });
    const branches = await tx.branch.findMany({ where: { businessId: ctx.businessId }, select: { id: true } });
    await tx.branchStock.createMany({
      data: branches.map((b) => ({ businessId: ctx.businessId, branchId: b.id, stockItemId: item.id, reorderLevel: input.reorderLevel })),
    });
    await audit(tx, ctx, "stock.item.create", "StockItem", item.id, { name, unit: input.unit });
    return item;
  });
}

/** The name is shared by every branch; the reorder level is for the branch you are working in. */
export async function updateStockItem(ctx: TenantContext, id: string, input: { name: string; reorderLevel: number }) {
  need(ctx, "stock.manage");
  const { businessId, branchId } = scope(ctx);
  const name = cleanName(input.name);
  checkReorder(input.reorderLevel);
  const item = await db.stockItem.findFirst({ where: { id, businessId } });
  if (!item) throw new DomainError("Stock item not found.");
  const clash = await db.stockItem.findFirst({
    where: { businessId, name: { equals: name, mode: "insensitive" }, id: { not: id } },
  });
  if (clash) throw new DomainError("A stock item with that name already exists.");
  await db.$transaction(async (tx) => {
    await tx.stockItem.update({ where: { businessId_id: { businessId, id } }, data: { name } });
    await levelFor(tx, businessId, branchId, id);
    await tx.branchStock.update({
      where: { branchId_stockItemId: { branchId, stockItemId: id } },
      data: { reorderLevel: input.reorderLevel },
    });
    await audit(tx, ctx, "stock.item.update", "StockItem", id, { from: item.name, to: name, branchId, reorderLevel: input.reorderLevel });
  });
}

/** Hide an item from lists in every branch. Its history stays. Refused while a recipe still uses it. */
export async function archiveStockItem(ctx: TenantContext, id: string) {
  need(ctx, "stock.manage");
  const item = await db.stockItem.findFirst({
    where: { id, businessId: ctx.businessId },
    include: { _count: { select: { recipes: true } } },
  });
  if (!item) throw new DomainError("Stock item not found.");
  if (item._count.recipes > 0) throw new DomainError("A recipe still uses this item. Remove it from the recipes first.");
  await db.$transaction(async (tx) => {
    await tx.stockItem.update({ where: { businessId_id: { businessId: ctx.businessId, id } }, data: { active: false } });
    await audit(tx, ctx, "stock.item.archive", "StockItem", id, { name: item.name });
  });
}

// --- movements ---------------------------------------------------------------

export interface PurchaseLine {
  stockItemId: string;
  quantity: number;
  /** Total paid for this line, in paisa. */
  totalCost: number;
}

/** Goods received. Adds to stock and updates each item's average cost. */
export async function recordPurchase(ctx: TenantContext, input: { supplier?: string; lines: PurchaseLine[] }) {
  need(ctx, "stock.manage");
  if (input.lines.length === 0) throw new DomainError("Add at least one item.");
  if (input.lines.length > 30) throw new DomainError("That is a lot of lines. Please split it into two purchases.");
  const supplier = input.supplier?.trim().replace(/\s+/g, " ").slice(0, 80) || null;
  for (const l of input.lines) {
    wholeQty(l.quantity);
    if (!Number.isInteger(l.totalCost) || l.totalCost < 0 || l.totalCost > MAX_PAISA) {
      throw new DomainError("The cost must be a whole number of paisa, zero or more.");
    }
  }
  return db.$transaction(async (tx) => {
    await applyPurchaseLines(tx, ctx, input.lines, supplier, null, ctx.branchId);
    await audit(tx, ctx, "stock.purchase", "StockItem", input.lines[0].stockItemId, {
      supplier,
      lines: input.lines.length,
      total: input.lines.reduce((s, l) => s + l.totalCost, 0),
    });
  });
}

/**
 * Put received goods into one branch's stock and update that branch's average cost for each item. Used for a manual
 * purchase and for a delivery against a purchase order (which names its own branch). Lines are already validated by
 * the caller; the stock items must belong to the business and be active.
 */
export async function applyPurchaseLines(
  tx: Tx,
  ctx: TenantContext,
  lines: PurchaseLine[],
  supplier: string | null,
  note: string | null,
  branchId: string,
) {
  for (const line of lines) {
    const item = await tx.stockItem.findFirst({ where: { id: line.stockItemId, businessId: ctx.businessId, active: true } });
    if (!item) throw new DomainError("One of those stock items was not found.");
    const level = await activeLevelFor(tx, ctx.businessId, branchId, item.id);
    const costMilli = weightedAverageCost(level.quantity, level.costMilli, line.quantity, line.totalCost);
    await tx.branchStock.update({
      where: { branchId_stockItemId: { branchId, stockItemId: item.id } },
      data: { quantity: { increment: line.quantity }, costMilli },
    });
    await tx.stockMovement.create({
      data: {
        businessId: ctx.businessId,
        branchId,
        stockItemId: item.id,
        kind: "PURCHASE",
        quantity: line.quantity,
        unitCostMilli: Math.round((line.totalCost * 1000) / line.quantity),
        totalCost: line.totalCost,
        supplier,
        note,
        createdById: ctx.userId,
      },
    });
  }
}

export async function recordWaste(ctx: TenantContext, input: { stockItemId: string; quantity: number; reason: string }) {
  need(ctx, "stock.waste");
  const quantity = wholeQty(input.quantity);
  const reason = cleanReason(input.reason);
  await db.$transaction(async (tx) => {
    const item = await tx.stockItem.findFirst({ where: { id: input.stockItemId, businessId: ctx.businessId, active: true } });
    if (!item) throw new DomainError("Stock item not found.");
    const { branchId } = scope(ctx);
    const level = await activeLevelFor(tx, ctx.businessId, branchId, item.id);
    await tx.branchStock.update({
      where: { branchId_stockItemId: { branchId, stockItemId: item.id } },
      data: { quantity: { decrement: quantity } },
    });
    await tx.stockMovement.create({
      data: {
        businessId: ctx.businessId,
        branchId,
        stockItemId: item.id,
        kind: "WASTE",
        quantity: -quantity,
        unitCostMilli: level.costMilli,
        totalCost: -costOf(quantity, level.costMilli),
        note: reason,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, "stock.waste", "StockItem", item.id, { quantity, reason });
  });
}

/** A physical count. The book quantity becomes what was counted; the difference is recorded. */
export async function recordCount(ctx: TenantContext, input: { stockItemId: string; counted: number; note?: string }) {
  need(ctx, "stock.manage");
  if (!Number.isInteger(input.counted) || input.counted < 0 || input.counted > MAX_QTY) {
    throw new DomainError("Enter what you counted as a whole number, zero or more.");
  }
  const note = input.note?.trim().replace(/\s+/g, " ").slice(0, 200) || "Stock count";
  return db.$transaction(async (tx) => {
    const item = await tx.stockItem.findFirst({ where: { id: input.stockItemId, businessId: ctx.businessId, active: true } });
    if (!item) throw new DomainError("Stock item not found.");
    const { branchId } = scope(ctx);
    const level = await activeLevelFor(tx, ctx.businessId, branchId, item.id);
    const difference = input.counted - level.quantity;
    if (difference === 0) return { difference: 0 };
    await tx.branchStock.update({
      where: { branchId_stockItemId: { branchId, stockItemId: item.id } },
      data: { quantity: input.counted },
    });
    await tx.stockMovement.create({
      data: {
        businessId: ctx.businessId,
        branchId,
        stockItemId: item.id,
        kind: "COUNT",
        quantity: difference,
        unitCostMilli: level.costMilli,
        totalCost: costOf(difference, level.costMilli),
        note,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, "stock.count", "StockItem", item.id, { branchId, counted: input.counted, was: level.quantity, difference });
    return { difference };
  });
}

export async function listMovements(ctx: TenantContext, opts: { stockItemId?: string; limit?: number } = {}) {
  need(ctx, "stock.view");
  return db.stockMovement.findMany({
    where: { ...scope(ctx), ...(opts.stockItemId ? { stockItemId: opts.stockItemId } : {}) },
    include: { stockItem: { select: { name: true, unit: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 100, 300),
  });
}

// --- recipes -----------------------------------------------------------------

export interface RecipeInput {
  stockItemId: string;
  /** Base units used by one portion. */
  quantity: number;
}

/** Replace a dish's recipe. An empty list removes it. */
export async function setRecipe(ctx: TenantContext, menuItemId: string, lines: RecipeInput[]) {
  need(ctx, "stock.manage");
  if (lines.length > 30) throw new DomainError("A recipe can have at most 30 ingredients.");
  if (new Set(lines.map((l) => l.stockItemId)).size !== lines.length) throw new DomainError("Each ingredient can appear once.");
  for (const l of lines) wholeQty(l.quantity, "Each amount");
  await db.$transaction(async (tx) => {
    const dish = await tx.menuItem.findFirst({ where: { id: menuItemId, businessId: ctx.businessId } });
    if (!dish) throw new DomainError("Dish not found.");
    if (lines.length > 0) {
      const ids = lines.map((l) => l.stockItemId);
      const found = await tx.stockItem.count({ where: { id: { in: ids }, businessId: ctx.businessId, active: true } });
      if (found !== ids.length) throw new DomainError("One of those ingredients was not found.");
    }
    await tx.recipeLine.deleteMany({ where: { businessId: ctx.businessId, menuItemId } });
    if (lines.length > 0) {
      await tx.recipeLine.createMany({
        data: lines.map((l) => ({ businessId: ctx.businessId, menuItemId, stockItemId: l.stockItemId, quantity: l.quantity })),
      });
    }
    await audit(tx, ctx, "stock.recipe", "MenuItem", menuItemId, { dish: dish.name, lines: lines.length });
  });
}

/** Every dish with its recipe. The cost of each ingredient is this branch's average cost, so margins are per branch. */
export async function getRecipes(ctx: TenantContext) {
  need(ctx, "stock.view");
  const { businessId, branchId } = scope(ctx);
  const [dishes, levels] = await Promise.all([
    db.menuItem.findMany({
      where: { businessId },
      include: {
        category: { select: { name: true } },
        recipe: { include: { stockItem: { select: { name: true, unit: true } } }, orderBy: { stockItem: { name: "asc" } } },
      },
      orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
    }),
    db.branchStock.findMany({ where: { businessId, branchId }, select: { stockItemId: true, costMilli: true } }),
  ]);
  const cost = new Map(levels.map((l) => [l.stockItemId, l.costMilli]));
  return dishes.map((d) => ({
    ...d,
    recipe: d.recipe.map((r) => ({ ...r, stockItem: { ...r.stockItem, costMilli: cost.get(r.stockItemId) ?? 0 } })),
  }));
}
