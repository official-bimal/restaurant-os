/**
 * Depreciation of fixed assets on the reducing balance. Pure functions, no I/O.
 *
 * Each fiscal year an asset loses a fixed percentage of the value it has left. In the year it is bought (or sold) it loses only the part
 * of the year it was owned, counted in days. Nepal's tax rules put assets into pooled blocks with their own rates; this works asset by
 * asset, so a business pays tax on figures its accountant works out under the Income Tax Act.
 */
import { addDays } from "@/lib/business-day";

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface AssetInput {
  cost: number;
  /** Depreciation already taken in earlier years. */
  accumulated: number;
  rateBps: number;
  purchaseDate: string;
  disposedOn: string | null;
}

/** The depreciation for one fiscal year (from and to are its first and last dates). Never more than the value left. */
export function yearlyDepreciation(a: AssetInput, from: string, to: string): number {
  const ownedFrom = a.purchaseDate > from ? a.purchaseDate : from;
  const ownedTo = a.disposedOn && a.disposedOn < to ? a.disposedOn : to;
  if (ownedFrom > ownedTo) return 0;
  const owned = daysBetween(ownedFrom, ownedTo) + 1;
  const yearDays = daysBetween(from, to) + 1;
  const left = a.cost - a.accumulated;
  if (left <= 0) return 0;
  return Math.min(left, Math.round(((left * a.rateBps) / 10_000) * (owned / yearDays)));
}

/** The first day after a date, for callers that need the start of the next period. */
export const nextDay = (date: string) => addDays(date, 1);
