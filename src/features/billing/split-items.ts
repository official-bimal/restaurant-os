/**
 * Splitting one table's bill between guests, item by item. Pure, no I/O; money is integer paisa.
 *
 * Every unit of every item goes to one guest, or is shared equally by several. A shared unit is cut into equal parts (the odd paisa go to
 * the first guests), so a bill's parts always add up to the original line to the paisa. The result is a list of lines per guest.
 */

export const MAX_GUESTS = 8;

export interface SplitItem {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

/** For one item: `units[u]` is the guests (0-based) who have unit u. One guest: it is theirs. Several: they share it equally. */
export interface Assignment {
  itemId: string;
  units: number[][];
}

export interface PlannedLine {
  itemId: string;
  guest: number;
  quantity: number;
  /** The price of one unit on this guest's bill (a share, when shared). */
  unitPrice: number;
  /** 1 for a whole dish; 3 for a third of one. */
  shareDen: number;
}

/** What a shared line is called on the bill. */
export function shareName(name: string, den: number): string {
  return den > 1 ? `${name} (1/${den} share)` : name;
}

/** `price` cut into `parts` equal parts; the odd paisa go one each to the first parts. The parts add up to `price`. */
export function cutPrice(price: number, parts: number): number[] {
  if (!Number.isInteger(price) || price < 0) throw new RangeError("price must be a non-negative integer");
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError("parts must be at least 1");
  const base = Math.floor(price / parts);
  const extra = price - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Turn the guests' choices into lines. Throws a RangeError with a message for staff when something is wrong: a unit nobody has, a guest who
 * is not there, an item missing or counted wrongly, or a guest left with nothing.
 */
export function planSplit(items: readonly SplitItem[], assignments: readonly Assignment[], guestCount: number): PlannedLine[] {
  if (!Number.isInteger(guestCount) || guestCount < 2 || guestCount > MAX_GUESTS) throw new RangeError(`Split between 2 and ${MAX_GUESTS} guests.`);
  const byItem = new Map<string, Assignment>();
  for (const a of assignments) {
    if (byItem.has(a.itemId)) throw new RangeError("An item was listed twice.");
    byItem.set(a.itemId, a);
  }
  if (byItem.size !== items.length) throw new RangeError("Every item on the bill needs to be given to someone.");

  const lines: PlannedLine[] = [];
  for (const item of items) {
    const a = byItem.get(item.id);
    if (!a) throw new RangeError("Every item on the bill needs to be given to someone.");
    if (a.units.length !== item.quantity) throw new RangeError(`${item.name}: all ${item.quantity} need to be given to someone.`);
    // Units that go to exactly the same people become one line.
    const groups = new Map<string, { guests: number[]; units: number }>();
    for (const u of a.units) {
      if (!Array.isArray(u) || u.length === 0) throw new RangeError(`${item.name}: someone has to take each one.`);
      const guests = [...new Set(u)].sort((x, y) => x - y);
      if (guests.length !== u.length || guests.some((g) => !Number.isInteger(g) || g < 0 || g >= guestCount)) throw new RangeError(`${item.name}: that guest is not on this bill.`);
      const key = guests.join(",");
      const g = groups.get(key);
      if (g) g.units++;
      else groups.set(key, { guests, units: 1 });
    }
    for (const { guests, units } of groups.values()) {
      if (guests.length === 1) {
        lines.push({ itemId: item.id, guest: guests[0]!, quantity: units, unitPrice: item.unitPrice, shareDen: 1 });
      } else {
        const parts = cutPrice(item.unitPrice, guests.length);
        guests.forEach((guest, i) => lines.push({ itemId: item.id, guest, quantity: units, unitPrice: parts[i]!, shareDen: guests.length }));
      }
    }
  }
  for (let g = 0; g < guestCount; g++) if (!lines.some((l) => l.guest === g)) throw new RangeError(`Guest ${g + 1} has nothing on their bill.`);
  return lines;
}

/** What one guest's lines come to before service charge, VAT and discounts. */
export function guestSubtotal(lines: readonly PlannedLine[], guest: number): number {
  return lines.filter((l) => l.guest === guest).reduce((n, l) => n + l.quantity * l.unitPrice, 0);
}

/** The starting point on screen: every unit on the first guest, which is the bill as it is now. */
export function everythingOnFirst(items: readonly SplitItem[]): Assignment[] {
  return items.map((i) => ({ itemId: i.id, units: Array.from({ length: i.quantity }, () => [0]) }));
}

/** Share every unit equally between all guests. */
export function sharedByAll(items: readonly SplitItem[], guestCount: number): Assignment[] {
  const all = Array.from({ length: guestCount }, (_, g) => g);
  return items.map((i) => ({ itemId: i.id, units: Array.from({ length: i.quantity }, () => [...all]) }));
}

/** When guests are taken away, anything they had goes back to the first guest (or to those who remain, for a shared unit). */
export function dropGuests(assignments: readonly Assignment[], guestCount: number): Assignment[] {
  return assignments.map((a) => ({
    itemId: a.itemId,
    units: a.units.map((u) => {
      const kept = u.filter((g) => g < guestCount);
      return kept.length > 0 ? kept : [0];
    }),
  }));
}
