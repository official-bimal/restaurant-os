/**
 * Stock maths. Pure functions, no I/O.
 *
 * Quantities are whole numbers of a base unit (g, ml, piece). Costs are kept in thousandths of
 * a paisa per unit ("milli-paisa") so that cheap items such as salt (0.5 paisa a gram) keep their
 * precision; totals are rounded to whole paisa only when a movement is recorded.
 */

export const UNITS = ["g", "ml", "piece"] as const;
export type Unit = (typeof UNITS)[number];

export function isUnit(value: string): value is Unit {
  return (UNITS as readonly string[]).includes(value);
}

/** Cost of `quantity` units at `costMilli` per unit, in whole paisa. */
export function costOf(quantity: number, costMilli: number): number {
  return Math.round((quantity * costMilli) / 1000);
}

/**
 * New average cost after receiving `quantity` units that cost `totalPaisa` in all.
 * Stock that is already below zero was sold before it was booked in, so it carries no value
 * into the average: the new average is just this purchase's unit cost for what is left on hand.
 */
export function weightedAverageCost(
  onHand: number,
  currentCostMilli: number,
  quantity: number,
  totalPaisa: number,
): number {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError("quantity must be a positive whole number");
  if (!Number.isInteger(totalPaisa) || totalPaisa < 0) throw new RangeError("total cost must be a non-negative whole number of paisa");
  const base = Math.max(0, onHand);
  const value = base * currentCostMilli + totalPaisa * 1000;
  return Math.round(value / (base + quantity));
}

/** What one portion of a dish costs to make, in paisa, from its recipe lines. */
export function recipeCost(lines: { quantity: number; costMilli: number }[]): number {
  return Math.round(lines.reduce((sum, l) => sum + l.quantity * l.costMilli, 0) / 1000);
}

/** Margin of a dish over its ingredient cost. Null when there is no price to compare. */
export function margin(price: number, cost: number): { amount: number; percent: number | null } {
  return { amount: price - cost, percent: price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null };
}

/** Low means "at or below the reorder level", and only when a level has been set. */
export function stockStatus(quantity: number, reorderLevel: number): "NEGATIVE" | "OUT" | "LOW" | "OK" {
  if (quantity < 0) return "NEGATIVE";
  if (quantity === 0) return reorderLevel > 0 ? "OUT" : "OK";
  if (reorderLevel > 0 && quantity <= reorderLevel) return "LOW";
  return "OK";
}

/** What to take off stock for a bill: recipe quantity times portions sold, summed per stock item. */
export function consumption(
  sold: { menuItemId: string; quantity: number }[],
  recipes: Map<string, { stockItemId: string; quantity: number }[]>,
): Map<string, number> {
  const used = new Map<string, number>();
  for (const s of sold) {
    for (const line of recipes.get(s.menuItemId) ?? []) {
      used.set(line.stockItemId, (used.get(line.stockItemId) ?? 0) + line.quantity * s.quantity);
    }
  }
  return used;
}
