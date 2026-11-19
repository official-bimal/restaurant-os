/**
 * Automatic deals: happy hour (a percentage off chosen dishes in a time window) and combos (a set price for a bundle).
 * Pure functions, no I/O. Money is integer paisa.
 *
 * Deals never stack: of all the deals that qualify for a bill, the one that saves the guest most applies.
 */

export interface DealItemDef {
  menuItemId: string | null;
  categoryId: string | null;
  /** For a combo: how many of this are needed in each bundle. */
  quantity: number;
}

export interface DealDef {
  id: string;
  name: string;
  kind: "PERCENT_OFF" | "COMBO";
  /** Comma list of days, 0 (Sunday) to 6. Empty: every day. */
  days: string;
  /** Minutes from midnight. Both null: all day. A start after the end runs through midnight. */
  startMinute: number | null;
  endMinute: number | null;
  percentBps: number;
  comboPrice: number;
  items: DealItemDef[];
}

export interface DealLine {
  menuItemId: string;
  categoryId: string | null;
  unitPrice: number;
  quantity: number;
  complimentary: boolean;
}

/** The weekday (0 = Sunday) and minute of the day in a time zone. */
export function localDayMinute(instant: Date, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function isActiveAt(deal: Pick<DealDef, "days" | "startMinute" | "endMinute">, when: { day: number; minute: number }): boolean {
  const days = deal.days
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map(Number);
  if (days.length > 0 && !days.includes(when.day)) return false;
  const { startMinute: s, endMinute: e } = deal;
  if (s === null || e === null) return true;
  if (s === e) return true;
  return s < e ? when.minute >= s && when.minute < e : when.minute >= s || when.minute < e;
}

const matches = (item: DealItemDef, line: DealLine) => (item.menuItemId !== null && item.menuItemId === line.menuItemId) || (item.categoryId !== null && item.categoryId === line.categoryId);

/** What one deal would take off these lines. Zero when it does not apply. */
export function dealDiscount(deal: DealDef, lines: DealLine[]): number {
  const paying = lines.filter((l) => !l.complimentary && l.quantity > 0 && l.unitPrice > 0);
  if (deal.kind === "PERCENT_OFF") {
    if (!(deal.percentBps > 0 && deal.percentBps <= 10_000)) return 0;
    const covered = deal.items.length === 0 ? paying : paying.filter((l) => deal.items.some((i) => matches(i, l)));
    const total = covered.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
    return Math.round((total * deal.percentBps) / 10_000);
  }
  // COMBO: take whole bundles, using the cheapest matching dishes, and charge the set price for each.
  if (deal.comboPrice <= 0 || deal.items.length === 0) return 0;
  const pool: { price: number; used: boolean }[] = [];
  const unitsFor = new Map<DealItemDef, number[]>();
  const all = paying.flatMap((l) => Array.from({ length: l.quantity }, () => ({ price: l.unitPrice, line: l })));
  all.sort((a, b) => a.price - b.price);
  for (const u of all) pool.push({ price: u.price, used: false });
  for (const item of deal.items) {
    unitsFor.set(
      item,
      all.map((u, idx) => (matches(item, u.line) ? idx : -1)).filter((i) => i >= 0),
    );
  }
  let bundles = 0;
  let worth = 0;
  for (let round = 0; round < 50; round++) {
    const taken: number[] = [];
    let ok = true;
    for (const item of deal.items) {
      const free = unitsFor.get(item)!.filter((i) => !pool[i]!.used && !taken.includes(i));
      if (free.length < item.quantity) {
        ok = false;
        break;
      }
      taken.push(...free.slice(0, item.quantity));
    }
    if (!ok) break;
    for (const i of taken) pool[i]!.used = true;
    bundles++;
    worth += taken.reduce((n, i) => n + pool[i]!.price, 0);
  }
  return Math.max(0, worth - deal.comboPrice * bundles);
}

/** The deal that saves the most right now, or null when none applies. */
export function bestDeal(deals: DealDef[], lines: DealLine[], when: { day: number; minute: number }): { deal: DealDef; amount: number } | null {
  let best: { deal: DealDef; amount: number } | null = null;
  for (const d of deals) {
    if (!isActiveAt(d, when)) continue;
    const amount = dealDiscount(d, lines);
    if (amount > 0 && (!best || amount > best.amount)) best = { deal: d, amount };
  }
  return best;
}

/**
 * Puts the deal's saving and the person's own discount together as one amount. A percentage the person chose is taken off what is left after
 * the deal, so the two never take off more than the bill.
 */
export function combineDiscount(manual: { kind: "none" } | { kind: "percent"; bps: number } | { kind: "amount"; amount: number }, subtotal: number, dealAmount: number) {
  const afterDeal = Math.max(0, subtotal - dealAmount);
  const own = manual.kind === "percent" ? Math.round((afterDeal * manual.bps) / 10_000) : manual.kind === "amount" ? Math.min(manual.amount, afterDeal) : 0;
  return { kind: "amount" as const, amount: dealAmount + own };
}
