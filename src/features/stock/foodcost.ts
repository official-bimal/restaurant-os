/**
 * Food cost analysis. Pure functions, no I/O. Money is integer paisa.
 *
 * Food cost % is what the ingredients cost as a share of what the food sold for (before VAT and service charge). Each dish is also sorted by
 * "menu engineering": how well it sells against how much it earns per plate.
 */

export interface DishSale {
  menuItemId: string;
  name: string;
  /** Portions sold (free ones included: they cost the kitchen even though they earn nothing). */
  quantity: number;
  /** What those portions earned, before VAT. */
  revenue: number;
  /** Cost of one portion from its recipe, or null when it has no recipe. */
  unitCost: number | null;
  /** True when the dish has a recipe but some ingredient has no price yet, so its cost cannot be worked out. */
  missingCost?: boolean;
}

export type DishClass = "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG" | "NO_RECIPE" | "NO_COST";

export interface DishRow extends DishSale {
  cost: number | null;
  profit: number | null;
  /** Cost as a percentage of revenue, one decimal. */
  costPercent: number | null;
  /** Profit per portion sold. */
  profitEach: number | null;
  klass: DishClass;
}

/**
 * Sorts dishes the usual way:
 * star (sells well, earns well), plowhorse (sells well, earns little), puzzle (earns well, sells little), dog (neither).
 * A dish "sells well" when it has at least 70% of an equal share of all portions sold; it "earns well" when its profit per portion is at
 * least the average profit per portion across everything sold. Dishes with no recipe cannot be judged.
 */
export function analyse(sales: DishSale[]): DishRow[] {
  const judged = sales.filter((s) => s.unitCost !== null && s.quantity > 0);
  const totalQty = judged.reduce((n, s) => n + s.quantity, 0);
  const totalProfit = judged.reduce((n, s) => n + (s.revenue - s.unitCost! * s.quantity), 0);
  const avgProfitEach = totalQty > 0 ? totalProfit / totalQty : 0;
  const popularAt = judged.length > 0 ? (0.7 * totalQty) / judged.length : 0;

  return sales.map((s) => {
    if (s.unitCost === null) return { ...s, cost: null, profit: null, costPercent: null, profitEach: null, klass: s.missingCost ? "NO_COST" : "NO_RECIPE" };
    const cost = s.unitCost * s.quantity;
    const profit = s.revenue - cost;
    const profitEach = s.quantity > 0 ? Math.round(profit / s.quantity) : 0;
    const popular = s.quantity >= popularAt && s.quantity > 0;
    // A dish nobody ordered in the period earns nothing, however good its margin looks.
    const earns = s.quantity > 0 && profitEach >= avgProfitEach;
    const klass: DishClass = popular ? (earns ? "STAR" : "PLOWHORSE") : earns ? "PUZZLE" : "DOG";
    return { ...s, cost, profit, costPercent: s.revenue > 0 ? Math.round((cost / s.revenue) * 1000) / 10 : null, profitEach, klass };
  });
}

/** The price at which a dish costing `cost` hits a target food cost %, rounded up to the next `step` (default Rs 5). */
export function suggestedPrice(cost: number, targetPercent: number, step = 500): number {
  if (!(targetPercent > 0 && targetPercent < 100) || cost <= 0) return 0;
  const exact = (cost * 100) / targetPercent;
  return Math.ceil(exact / step) * step;
}

/** Overall food cost %: what was used (by sales, or including waste and count losses) as a share of sales. Null with no sales. */
export function foodCostPercent(used: number, sales: number): number | null {
  return sales > 0 ? Math.round((used / sales) * 1000) / 10 : null;
}

/** Price without VAT, when menu prices include it. */
export function withoutVat(price: number, vatBps: number, inclusive: boolean): number {
  return inclusive && vatBps > 0 ? Math.round((price * 10_000) / (10_000 + vatBps)) : price;
}
