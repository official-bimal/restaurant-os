/**
 * Reorder suggestions from how fast stock is really used. Pure functions, no I/O.
 *
 * Quantities are whole numbers of a stock item's base unit (g, ml or piece). For each item: how much is used per day (from the last few weeks of sales and
 * waste), how many days the stock will last, and how much to order so that, when the order arrives after the supplier's lead time, there is enough for the
 * days of cover wanted. Orders are rounded up to whole packs.
 */

export const WINDOW_CHOICES = [14, 28, 56] as const;
export const COVER_CHOICES = [3, 7, 14] as const;
export const DEFAULT_WINDOW = 28;
export const DEFAULT_COVER = 7;

/** Units used per day, from what was used over `days` days. */
export function dailyUse(used: number, days: number): number {
  return days > 0 && used > 0 ? used / days : 0;
}

/**
 * How many days of history there really are, between 1 and the window: a café that opened last week has a week of sales, not a month, and dividing a
 * week's use by 28 days would order far too little.
 */
export function dataDays(firstUseAt: Date | null, now: Date, window: number): number {
  if (!firstUseAt) return window;
  const days = Math.ceil((now.getTime() - firstUseAt.getTime()) / 86_400_000);
  return Math.min(window, Math.max(1, days));
}

export type Urgency = "NOW" | "SOON" | "OK";

export interface ReorderInput {
  onHand: number;
  onOrder: number;
  dailyUse: number;
  leadDays: number;
  coverDays: number;
  packQuantity: number;
  reorderLevel: number;
}

export interface ReorderLine {
  /** How much to order, in whole packs of base units. Zero when nothing is needed. */
  quantity: number;
  /** Days the stock on hand lasts at the current rate, or null when nothing has been used. */
  daysLeft: number | null;
  urgency: Urgency;
}

export function planItem(i: ReorderInput): ReorderLine {
  const onHand = Math.max(0, i.onHand);
  const pack = Math.max(1, Math.floor(i.packQuantity) || 1);
  const target = Math.max(Math.ceil(i.dailyUse * (i.leadDays + i.coverDays)), Math.max(0, i.reorderLevel));
  const need = target - onHand - Math.max(0, i.onOrder);
  const quantity = need > 0 ? Math.ceil(need / pack) * pack : 0;
  const daysLeft = i.dailyUse > 0 ? Math.round((onHand / i.dailyUse) * 10) / 10 : null;

  let urgency: Urgency = "OK";
  if (daysLeft !== null) {
    if (daysLeft <= i.leadDays) urgency = "NOW";
    else if (daysLeft <= i.leadDays + i.coverDays / 2) urgency = "SOON";
  } else if (i.reorderLevel > 0) {
    if (onHand <= 0) urgency = "NOW";
    else if (onHand <= i.reorderLevel) urgency = "SOON";
  }
  // Nothing to order means nothing is urgent, whatever the days left (it is already on its way).
  if (quantity === 0) urgency = "OK";
  return { quantity, daysLeft, urgency };
}

const RANK: Record<Urgency, number> = { NOW: 0, SOON: 1, OK: 2 };
export const byUrgency = (a: { urgency: Urgency; name: string }, b: { urgency: Urgency; name: string }) => RANK[a.urgency] - RANK[b.urgency] || a.name.localeCompare(b.name);

/** A quantity in the unit people say it in: grams as kg, millilitres as litres. */
export function showQty(quantity: number, unit: string): string {
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
  if (unit === "g") return quantity >= 1000 ? `${n(quantity / 1000)} kg` : `${quantity} g`;
  if (unit === "ml") return quantity >= 1000 ? `${n(quantity / 1000)} L` : `${quantity} ml`;
  return `${quantity} pc`;
}
