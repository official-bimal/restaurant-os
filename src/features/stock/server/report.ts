import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { addDays, dayRange, isValidDate, localDate } from "@/lib/business-day";
import { costOf } from "@/features/stock/stock";
import { ensureLevels } from "./levels";

/**
 * Stock value and stock cost across branches. What the shelves hold is worth quantity x that branch's average cost
 * (stock below zero counts as nothing, and is flagged). Over a period it also adds up what was bought, used by sales,
 * wasted, adjusted by counts and moved between branches, and what was lost on the way. Money is integer paisa.
 * Only the branches the person works in are included.
 */

function needReport(ctx: TenantContext) {
  if (!can(ctx.role, "report.view") || !can(ctx.role, "stock.view")) {
    throw new DomainError("You do not have permission to see the stock value report.");
  }
}

export interface BranchCosts {
  purchases: number;
  usedBySales: number;
  waste: number;
  /** Counts that corrected the book: positive found stock, negative missing stock. */
  countAdjustments: number;
  sentOut: number;
  receivedIn: number;
  lostInTransit: number;
}

export async function getStockValueReport(ctx: TenantContext, range: { from?: string; to?: string } = {}) {
  needReport(ctx);
  const { businessId } = ctx;
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const today = localDate(new Date(), business.timezone);
  const to = range.to ?? today;
  const from = range.from ?? `${to.slice(0, 8)}01`; // the first of the month by default
  if (!isValidDate(from) || !isValidDate(to)) throw new DomainError("Choose valid dates.");
  if (from > to) throw new DomainError("The start date must not be after the end date.");
  if (to > addDays(from, 366)) throw new DomainError("Choose a period of a year or less.");
  const start = dayRange(from, business.timezone).start;
  const end = dayRange(to, business.timezone).end;

  const branches = await db.branch.findMany({
    where: { businessId, id: { in: ctx.branchIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, active: true },
  });
  const ids = branches.map((b) => b.id);
  await Promise.all(branches.filter((b) => b.active).map((b) => ensureLevels(db, businessId, b.id)));

  const [items, levels, transit, movements, lost] = await Promise.all([
    db.stockItem.findMany({ where: { businessId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true } }),
    db.branchStock.findMany({ where: { businessId, branchId: { in: ids } } }),
    db.stockTransfer.findMany({ where: { businessId, status: "IN_TRANSIT", toBranchId: { in: ids } }, select: { toBranchId: true, quantity: true, unitCostMilli: true } }),
    db.stockMovement.groupBy({
      by: ["branchId", "kind"],
      where: { businessId, branchId: { in: ids }, createdAt: { gte: start, lt: end } },
      _sum: { totalCost: true },
    }),
    db.stockTransfer.findMany({
      where: { businessId, status: "RECEIVED", toBranchId: { in: ids }, receivedAt: { gte: start, lt: end } },
      select: { toBranchId: true, quantity: true, receivedQuantity: true, unitCostMilli: true },
    }),
  ]);

  const levelAt = new Map(levels.map((l) => [`${l.branchId}:${l.stockItemId}`, l]));
  const rows = items.map((i) => {
    const perBranch = branches.map((b) => {
      const l = levelAt.get(`${b.id}:${i.id}`);
      const quantity = l?.quantity ?? 0;
      const costMilli = l?.costMilli ?? 0;
      return { branchId: b.id, quantity, costMilli, stocked: l?.active ?? true, value: l?.active === false ? 0 : costOf(Math.max(0, quantity), costMilli) };
    });
    const totalQuantity = perBranch.reduce((n, p) => n + Math.max(0, p.quantity), 0);
    const totalValue = perBranch.reduce((n, p) => n + p.value, 0);
    return {
      ...i,
      perBranch,
      totalQuantity,
      totalValue,
      // What a unit costs across the business, weighted by how much each branch holds.
      avgCostMilli: totalQuantity > 0 ? Math.round((totalValue * 1000) / totalQuantity) : 0,
      belowZero: perBranch.some((p) => p.stocked && p.quantity < 0),
    };
  });

  const onTheWay = new Map<string, number>();
  for (const t of transit) onTheWay.set(t.toBranchId, (onTheWay.get(t.toBranchId) ?? 0) + costOf(t.quantity, t.unitCostMilli));

  const costs = new Map<string, BranchCosts>(ids.map((id) => [id, { purchases: 0, usedBySales: 0, waste: 0, countAdjustments: 0, sentOut: 0, receivedIn: 0, lostInTransit: 0 }]));
  for (const m of movements) {
    const c = costs.get(m.branchId)!;
    const v = m._sum.totalCost ?? 0;
    if (m.kind === "PURCHASE") c.purchases += v;
    else if (m.kind === "SALE") c.usedBySales += -v;
    else if (m.kind === "WASTE") c.waste += -v;
    else if (m.kind === "COUNT") c.countAdjustments += v;
    else if (m.kind === "TRANSFER_OUT") c.sentOut += -v;
    else if (m.kind === "TRANSFER_IN") c.receivedIn += v;
  }
  for (const t of lost) {
    const shortfall = t.quantity - (t.receivedQuantity ?? t.quantity);
    if (shortfall > 0) costs.get(t.toBranchId)!.lostInTransit += costOf(shortfall, t.unitCostMilli);
  }

  const sum = (f: (r: (typeof rows)[number]["perBranch"][number]) => number, i: number) => rows.reduce((n, r) => n + f(r.perBranch[i]!), 0);
  const perBranch = branches.map((b, i) => ({
    ...b,
    value: sum((p) => p.value, i),
    onTheWayValue: onTheWay.get(b.id) ?? 0,
    belowZeroItems: rows.filter((r) => r.perBranch[i]!.stocked && r.perBranch[i]!.quantity < 0).length,
    costs: costs.get(b.id)!,
  }));
  const total = (f: (c: BranchCosts) => number) => perBranch.reduce((n, b) => n + f(b.costs), 0);

  return {
    from,
    to,
    branches: perBranch,
    rows,
    totals: {
      value: perBranch.reduce((n, b) => n + b.value, 0),
      onTheWayValue: perBranch.reduce((n, b) => n + b.onTheWayValue, 0),
      costs: {
        purchases: total((c) => c.purchases),
        usedBySales: total((c) => c.usedBySales),
        waste: total((c) => c.waste),
        countAdjustments: total((c) => c.countAdjustments),
        sentOut: total((c) => c.sentOut),
        receivedIn: total((c) => c.receivedIn),
        lostInTransit: total((c) => c.lostInTransit),
      } satisfies BranchCosts,
    },
  };
}
