/**
 * Stamp cards ("every 10th coffee free"). Pure functions, no I/O.
 *
 * Each qualifying dish bought is a stamp. Each `target` stamps earns one free dish. What has already been given away is subtracted, so the
 * count cannot drift: it is always worked out from the bills and the free dishes given.
 */

export interface CardState {
  /** Stamps earned in total from paid bills. */
  stamps: number;
  /** Free dishes already given. */
  redeemed: number;
  /** Stamps on the card being filled now (0 up to target - 1). */
  inCard: number;
  /** Free dishes ready to use. */
  available: number;
  /** Stamps still needed for the next free dish. */
  toGo: number;
}

export function cardState(stamps: number, redeemed: number, target: number): CardState {
  const t = Math.max(1, Math.floor(target));
  const left = Math.max(0, stamps - redeemed * t);
  const available = Math.floor(left / t);
  const inCard = left % t;
  return { stamps, redeemed, inCard, available, toGo: available > 0 ? 0 : t - inCard };
}

export interface CountableItem {
  menuItemId: string;
  categoryId: string | null;
  quantity: number;
  complimentary: boolean;
}

export interface ProgramItemDef {
  menuItemId: string | null;
  categoryId: string | null;
}

/** Whether a dish earns stamps (and can be the free one) in a programme. A programme with no list covers every dish. */
export function qualifies(items: ProgramItemDef[], dish: { menuItemId: string; categoryId: string | null }): boolean {
  if (items.length === 0) return true;
  return items.some((i) => (i.menuItemId !== null && i.menuItemId === dish.menuItemId) || (i.categoryId !== null && i.categoryId === dish.categoryId));
}

/** Stamps from a list of bought dishes: one per qualifying paid unit. Free (complimentary) dishes earn nothing. */
export function countStamps(items: ProgramItemDef[], bought: CountableItem[]): number {
  return bought.filter((b) => !b.complimentary && qualifies(items, b)).reduce((n, b) => n + b.quantity, 0);
}
