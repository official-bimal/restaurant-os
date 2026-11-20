import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { scope } from "@/server/branch";
import { addDays, dayRange, isValidDate, localDate } from "@/lib/business-day";
import { costOf } from "@/features/stock/stock";
import { summarizeWaste } from "@/features/stock/count";
import { activeLevelFor } from "./levels";

/**
 * Count sheets and the waste report. A count sheet is one walk round the shelves: the person writes down what is really there for
 * the items they counted (the ones they leave blank are not touched), and every difference corrects the book in one go. Each
 * correction is a COUNT movement carrying the sheet's id, so the sheet can be looked at later. The count replaces the book
 * quantity at the moment it is saved, so count when nothing is being sold, or count the shelves item by item as you go.
 */

const MAX_QTY = 1_000_000_000;
const MAX_LINES = 400;

function needManage(ctx: TenantContext) {
  if (!can(ctx, "stock.manage")) throw new DomainError("You do not have permission to count stock.");
}

export interface CountLine {
  stockItemId: string;
  counted: number;
}

export async function recordCountSheet(ctx: TenantContext, input: { lines: CountLine[]; note?: string }) {
  needManage(ctx);
  const { businessId, branchId } = scope(ctx);
  if (input.lines.length === 0) throw new DomainError("Count at least one item.");
  if (input.lines.length > MAX_LINES) throw new DomainError("That is too many items for one count. Please split it.");
  if (new Set(input.lines.map((l) => l.stockItemId)).size !== input.lines.length) throw new DomainError("Each item can be counted once on a sheet.");
  for (const l of input.lines) {
    if (!Number.isInteger(l.counted) || l.counted < 0 || l.counted > MAX_QTY) throw new DomainError("Enter what you counted as a whole number, zero or more.");
  }
  const note = input.note?.trim().replace(/\s+/g, " ").slice(0, 200) || null;

  return db.$transaction(async (tx) => {
    const sheet = await tx.stockCount.create({ data: { businessId, branchId, note, createdById: ctx.userId, itemsCounted: input.lines.length, itemsChanged: 0 } });
    let changed = 0;
    let valueChange = 0;
    const result: { stockItemId: string; name: string; unit: string; was: number; counted: number; difference: number; value: number }[] = [];
    for (const line of input.lines) {
      const item = await tx.stockItem.findFirst({ where: { id: line.stockItemId, businessId, active: true } });
      if (!item) throw new DomainError("One of those stock items was not found.");
      const level = await activeLevelFor(tx, businessId, branchId, item.id);
      const diff = line.counted - level.quantity;
      const value = costOf(diff, level.costMilli);
      result.push({ stockItemId: item.id, name: item.name, unit: item.unit, was: level.quantity, counted: line.counted, difference: diff, value });
      if (diff === 0) continue;
      await tx.branchStock.update({ where: { branchId_stockItemId: { branchId, stockItemId: item.id } }, data: { quantity: line.counted } });
      await tx.stockMovement.create({
        data: {
          businessId,
          branchId,
          stockItemId: item.id,
          kind: "COUNT",
          quantity: diff,
          unitCostMilli: level.costMilli,
          totalCost: value,
          note: note ?? "Stock count",
          countId: sheet.id,
          createdById: ctx.userId,
        },
      });
      changed += 1;
      valueChange += value;
    }
    await tx.stockCount.update({ where: { id: sheet.id }, data: { itemsChanged: changed, valueChange } });
    await audit(tx, ctx, "stock.countSheet", "StockCount", sheet.id, { branchId, counted: input.lines.length, changed, valueChange });
    return { id: sheet.id, counted: input.lines.length, changed, valueChange, lines: result };
  });
}

/** The most recent count sheets of this branch. */
export async function listCountSheets(ctx: TenantContext, limit = 30) {
  if (!can(ctx, "stock.view")) throw new DomainError("You do not have permission to see stock.");
  const { businessId, branchId } = scope(ctx);
  return db.stockCount.findMany({ where: { businessId, branchId }, orderBy: { createdAt: "desc" }, take: Math.min(limit, 100) });
}

/** One sheet with every item that was different. */
export async function getCountSheet(ctx: TenantContext, id: string) {
  if (!can(ctx, "stock.view")) throw new DomainError("You do not have permission to see stock.");
  const { businessId, branchId } = scope(ctx);
  const sheet = await db.stockCount.findFirst({ where: { id, businessId, branchId } });
  if (!sheet) throw new DomainError("That count was not found.");
  const moves = await db.stockMovement.findMany({
    where: { businessId, countId: id },
    include: { stockItem: { select: { name: true, unit: true } } },
    orderBy: { stockItem: { name: "asc" } },
  });
  const who = sheet.createdById ? await db.user.findUnique({ where: { id: sheet.createdById }, select: { name: true } }) : null;
  return { sheet, who: who?.name ?? null, moves };
}

/** Waste over a period for this branch: what it cost, by cause and by item. Dates are the business's own days. */
export async function wasteReport(ctx: TenantContext, range: { from?: string; to?: string } = {}) {
  if (!can(ctx, "stock.view") || !(can(ctx, "stock.manage") || can(ctx, "report.view"))) throw new DomainError("You do not have permission to see the waste report.");
  const { businessId, branchId } = scope(ctx);
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const today = localDate(new Date(), business.timezone);
  const to = range.to ?? today;
  const from = range.from ?? addDays(to, -29);
  if (!isValidDate(from) || !isValidDate(to)) throw new DomainError("Choose valid dates.");
  if (from > to) throw new DomainError("The start date must not be after the end date.");
  if (to > addDays(from, 366)) throw new DomainError("Choose a period of a year or less.");
  const start = dayRange(from, business.timezone).start;
  const end = dayRange(to, business.timezone).end;
  const moves = await db.stockMovement.findMany({
    where: { businessId, branchId, kind: "WASTE", createdAt: { gte: start, lt: end } },
    include: { stockItem: { select: { name: true, unit: true } } },
    orderBy: { createdAt: "desc" },
  });
  const summary = summarizeWaste(
    moves.map((m) => ({ stockItemId: m.stockItemId, name: m.stockItem.name, unit: m.stockItem.unit, reason: m.reason, quantity: -m.quantity, cost: -m.totalCost })),
  );
  return { from, to, ...summary, entries: moves.length, recent: moves.slice(0, 40) };
}
