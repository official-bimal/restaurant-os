/**
 * Counting the shelves and adding up waste. Pure functions, no I/O.
 */

/** Why stock was thrown away. A short list the staff pick from, so waste can be added up by cause. */
export const WASTE_REASONS = [
  { id: "SPOILED", label: "Spoiled" },
  { id: "EXPIRED", label: "Expired" },
  { id: "DROPPED", label: "Dropped or spilled" },
  { id: "STAFF_MEAL", label: "Staff meal" },
  { id: "PREP_LOSS", label: "Lost in preparation" },
  { id: "OTHER", label: "Other" },
] as const;

export type WasteReason = (typeof WASTE_REASONS)[number]["id"];

export function isWasteReason(v: string): v is WasteReason {
  return WASTE_REASONS.some((r) => r.id === v);
}

export function wasteReasonLabel(id: string | null | undefined): string {
  return WASTE_REASONS.find((r) => r.id === id)?.label ?? "Not said";
}

/** What was counted against what the book says. Positive: more on the shelf than the book thought. */
export function difference(book: number, counted: number): number {
  return counted - book;
}

export type CountTone = "same" | "over" | "short";

export function countTone(diff: number): CountTone {
  return diff === 0 ? "same" : diff > 0 ? "over" : "short";
}

/** Parse what someone typed in a count box. Blank means "not counted" (null); anything else must be a whole number, zero or more. */
export function parseCounted(raw: string | null | undefined): number | null | "bad" {
  const s = (raw ?? "").trim().replace(/,/g, "");
  if (s === "") return null;
  if (!/^\d{1,10}$/.test(s)) return "bad";
  return Number(s);
}

export interface WasteRow {
  stockItemId: string;
  name: string;
  unit: string;
  reason: string | null;
  /** Positive amount thrown away. */
  quantity: number;
  /** Positive cost, in paisa. */
  cost: number;
}

/** Waste added up by cause and by item, biggest cost first. */
export function summarizeWaste(rows: WasteRow[]) {
  const byReason = new Map<string, { reason: string; label: string; cost: number; entries: number }>();
  const byItem = new Map<string, { stockItemId: string; name: string; unit: string; quantity: number; cost: number; entries: number }>();
  let total = 0;
  for (const r of rows) {
    total += r.cost;
    const key = r.reason && isWasteReason(r.reason) ? r.reason : "NONE";
    const reason = byReason.get(key) ?? { reason: key, label: wasteReasonLabel(key === "NONE" ? null : key), cost: 0, entries: 0 };
    reason.cost += r.cost;
    reason.entries += 1;
    byReason.set(key, reason);
    const item = byItem.get(r.stockItemId) ?? { stockItemId: r.stockItemId, name: r.name, unit: r.unit, quantity: 0, cost: 0, entries: 0 };
    item.quantity += r.quantity;
    item.cost += r.cost;
    item.entries += 1;
    byItem.set(r.stockItemId, item);
  }
  const byCost = <T extends { cost: number; name?: string; label?: string }>(a: T, b: T) => b.cost - a.cost || (a.name ?? a.label ?? "").localeCompare(b.name ?? b.label ?? "");
  return { total, byReason: [...byReason.values()].sort(byCost), byItem: [...byItem.values()].sort(byCost) };
}
