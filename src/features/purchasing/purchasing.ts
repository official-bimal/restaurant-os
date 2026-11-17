/**
 * Purchase order maths and wording. Pure functions, no I/O.
 * Quantities are whole numbers of a stock item's base unit (g, ml, piece); money is paisa.
 */

/** Aim to hold twice the reorder level once an order arrives. */
export const TARGET_MULTIPLE = 2;

/**
 * How much to order so that stock plus what is already on its way reaches the target.
 * Zero when no reorder level is set, or when stock and on-order already cover it.
 */
export function suggestQuantity(input: { quantity: number; reorderLevel: number; onOrder: number }): number {
  if (input.reorderLevel <= 0) return 0;
  const have = Math.max(0, input.quantity) + Math.max(0, input.onOrder);
  // Only suggest once the item is actually at or below its level (counting what is on its way).
  if (have > input.reorderLevel) return 0;
  return Math.max(0, input.reorderLevel * TARGET_MULTIPLE - have);
}

export interface LineProgress {
  quantityOrdered: number;
  quantityReceived: number;
}

export const remaining = (l: LineProgress) => Math.max(0, l.quantityOrdered - l.quantityReceived);

/** Everything ordered has arrived. */
export function isComplete(lines: LineProgress[]): boolean {
  return lines.length > 0 && lines.every((l) => l.quantityReceived >= l.quantityOrdered);
}

/** "none", "part" or "all" of the order has arrived. */
export function deliveryState(lines: LineProgress[]): "NONE" | "PART" | "ALL" {
  if (lines.every((l) => l.quantityReceived === 0)) return "NONE";
  return isComplete(lines) ? "ALL" : "PART";
}

/** What we expected to pay for a part of a line, in proportion to the whole, in whole paisa. */
export function proportionalEstimate(estimatedTotal: number, quantityOrdered: number, quantity: number): number {
  if (quantityOrdered <= 0) return 0;
  return Math.round((estimatedTotal * quantity) / quantityOrdered);
}

/** Paid minus expected for what has arrived (positive means it cost more than expected). */
export function priceVariance(line: { quantityOrdered: number; quantityReceived: number; estimatedTotal: number; paidTotal: number }): number {
  if (line.quantityReceived === 0) return 0;
  return line.paidTotal - proportionalEstimate(line.estimatedTotal, line.quantityOrdered, line.quantityReceived);
}

/** A plain text order a person can paste into a message to the supplier. */
export function orderText(input: {
  business: string;
  supplier: string;
  number: number;
  expectedOn: string | null;
  note: string | null;
  lines: { name: string; unit: string; quantity: number }[];
}): string {
  const rows = input.lines.map((l) => `- ${l.name}: ${l.quantity.toLocaleString("en-GB")} ${l.unit}`);
  return [
    `Order #${input.number} from ${input.business} for ${input.supplier}`,
    ...rows,
    ...(input.expectedOn ? [`Needed by ${input.expectedOn}`] : []),
    ...(input.note ? [`Note: ${input.note}`] : []),
    "Please confirm. Thank you.",
  ].join("\n");
}
