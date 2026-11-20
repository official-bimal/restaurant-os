import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { addDays, dayRange, isValidDate, localDate } from "@/lib/business-day";
import { recipeCost } from "@/features/stock/stock";
import { analyse, foodCostPercent, withoutVat, type DishSale } from "@/features/stock/foodcost";

/**
 * Food cost for the branch the person is working in: what each dish sold, what its ingredients cost (from its recipe at today's average
 * cost), and how the kitchen's real stock use compares with sales. Owners and managers. Figures are before VAT and service charge.
 * Add-ons are priced in the dish's price but their stock is not part of the dish's recipe cost, so a dish sold with many paid add-ons looks a little
 * more profitable than it is.
 */

function need(ctx: TenantContext) {
  if (!can(ctx, "stock.manage") || !can(ctx, "report.view")) throw new DomainError("You do not have permission to see food cost.");
}

export async function getFoodCostReport(ctx: TenantContext, range: { from?: string; to?: string } = {}) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const biz = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true, vatMode: true, vatBps: true } });
  const today = localDate(new Date(), biz.timezone);
  const to = range.to ?? today;
  const from = range.from ?? addDays(to, -29);
  if (!isValidDate(from) || !isValidDate(to)) throw new DomainError("Choose valid dates.");
  if (from > to) throw new DomainError("The start date must not be after the end date.");
  if (to > addDays(from, 366)) throw new DomainError("Choose a period of a year or less.");
  const start = dayRange(from, biz.timezone).start;
  const end = dayRange(to, biz.timezone).end;
  const inclusive = biz.vatMode === "INCLUSIVE";
  const inRange = { businessId, branchId, createdAt: { gte: start, lt: end } };

  const [items, invoices, movements, levels] = await Promise.all([
    db.orderItem.findMany({
      where: { businessId, status: { not: "CANCELLED" }, order: { invoice: { is: inRange } } },
      select: { menuItemId: true, name: true, quantity: true, unitPrice: true, complimentary: true },
    }),
    db.invoice.findMany({ where: inRange, select: { discount: true, loyaltyDiscount: true } }),
    db.stockMovement.groupBy({ by: ["kind"], where: { businessId, branchId, createdAt: { gte: start, lt: end } }, _sum: { totalCost: true } }),
    db.branchStock.findMany({ where: { businessId, branchId }, select: { stockItemId: true, costMilli: true } }),
  ]);

  const menuIds = [...new Set(items.map((i) => i.menuItemId))];
  const recipeLines = await db.recipeLine.findMany({ where: { businessId, menuItemId: { in: menuIds } }, select: { menuItemId: true, stockItemId: true, quantity: true } });
  const cost = new Map(levels.map((l) => [l.stockItemId, l.costMilli]));
  const unitCost = new Map<string, number>();
  const unpriced = new Set<string>();
  for (const id of menuIds) {
    const lines = recipeLines.filter((r) => r.menuItemId === id);
    if (lines.length === 0) continue;
    // An ingredient with no price yet would make the dish look free: wait until every ingredient has been bought at a real price.
    if (lines.some((l) => (cost.get(l.stockItemId) ?? 0) === 0)) {
      unpriced.add(id);
      continue;
    }
    unitCost.set(id, recipeCost(lines.map((l) => ({ quantity: l.quantity, costMilli: cost.get(l.stockItemId) ?? 0 }))));
  }

  const sold = new Map<string, DishSale>();
  for (const i of items) {
    const row = sold.get(i.menuItemId) ?? { menuItemId: i.menuItemId, name: i.name, quantity: 0, revenue: 0, unitCost: unitCost.get(i.menuItemId) ?? null, missingCost: unpriced.has(i.menuItemId) };
    row.quantity += i.quantity;
    row.revenue += i.complimentary ? 0 : withoutVat(i.unitPrice, biz.vatBps, inclusive) * i.quantity;
    sold.set(i.menuItemId, row);
  }
  const rows = analyse([...sold.values()]).sort((a, b) => b.quantity - a.quantity);

  const sum = (kind: string) => movements.find((m) => m.kind === kind)?._sum.totalCost ?? 0;
  const revenue = rows.reduce((n, r) => n + r.revenue, 0);
  const discounts = invoices.reduce((n, i) => n + withoutVat(i.discount + i.loyaltyDiscount, biz.vatBps, inclusive), 0);
  const netSales = Math.max(0, revenue - discounts);
  const usedBySales = -sum("SALE");
  const waste = -sum("WASTE");
  // A count that finds less than the book says is a loss (negative); finding more is a gain.
  const countLoss = -sum("COUNT");
  const noRecipeRevenue = rows.filter((r) => r.klass === "NO_RECIPE" || r.klass === "NO_COST").reduce((n, r) => n + r.revenue, 0);

  return {
    from,
    to,
    branchId,
    rows,
    totals: {
      revenue,
      discounts,
      netSales,
      usedBySales,
      waste,
      countLoss,
      foodCostPercent: foodCostPercent(usedBySales, netSales),
      /** Including waste and what counts found missing. */
      trueCostPercent: foodCostPercent(usedBySales + waste + countLoss, netSales),
      /** Share of sales from dishes that have no recipe: the higher it is, the less the percentages can be trusted. */
      noRecipeShare: revenue > 0 ? Math.round((noRecipeRevenue / revenue) * 1000) / 10 : 0,
    },
  };
}
