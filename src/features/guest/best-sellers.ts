/**
 * Which dishes a guest's menu calls "Best selling". Chosen from what was really sold lately, but the guest only ever sees
 * the dish names, never how many were sold.
 */

export const BEST_SELLER_DAYS = 30;
export const BEST_SELLER_LIMIT = 5;
/** A dish needs at least this many units sold in the window, so a quiet week does not crown a dish sold twice. */
export const BEST_SELLER_MIN_UNITS = 5;

/**
 * The top dishes by units sold, most first. Only dishes in `eligible` (on the menu and orderable right now at this
 * table) are considered. Ties are broken by id so the list does not flip around between page loads.
 */
export function pickBestSellers(
  sold: { menuItemId: string; quantity: number }[],
  eligible: ReadonlySet<string>,
  opts: { limit?: number; minUnits?: number } = {},
): string[] {
  const limit = opts.limit ?? BEST_SELLER_LIMIT;
  const minUnits = opts.minUnits ?? BEST_SELLER_MIN_UNITS;
  const totals = new Map<string, number>();
  for (const s of sold) {
    if (!eligible.has(s.menuItemId) || s.quantity <= 0) continue;
    totals.set(s.menuItemId, (totals.get(s.menuItemId) ?? 0) + s.quantity);
  }
  return [...totals]
    .filter(([, n]) => n >= minUnits)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id]) => id);
}
