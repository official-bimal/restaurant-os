/**
 * Nepali (Bikram Sambat) dates and the fiscal year. Pure functions, no I/O.
 *
 * Nepal's fiscal year runs from 1 Shrawan to the end of Ashadh (about 17 July to 16 July), and is written
 * like "2082/83". Books and invoice numbers restart each fiscal year. Dates here are the business's own
 * calendar dates, written YYYY-MM-DD in English (AD) years.
 */
import NepaliDate from "nepali-date-converter";

const SHRAWAN = 3; // zero-based month index: Baisakh = 0

export interface BsDate {
  year: number;
  /** 1 to 12 (Baisakh to Chaitra). */
  month: number;
  day: number;
}

export const BS_MONTHS = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"] as const;

function adToLocal(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/** The Bikram Sambat date of an English YYYY-MM-DD date. */
export function toBs(date: string): BsDate {
  const n = NepaliDate.fromAD(adToLocal(date));
  return { year: n.getYear(), month: n.getMonth() + 1, day: n.getDate() };
}

/** "2083-04-01" style text for a Bikram Sambat date. */
export function bsText(date: string): string {
  const b = toBs(date);
  return `${b.year}-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`;
}

/** The English YYYY-MM-DD date of a Bikram Sambat date. */
export function fromBs(year: number, month: number, day: number): string {
  const js = new NepaliDate(year, month - 1, day).toJsDate();
  const y = js.getFullYear();
  const m = js.getMonth() + 1;
  const d = js.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The fiscal year a date falls in, like "2082/83". */
export function fiscalYearOf(date: string): string {
  const b = toBs(date);
  const start = b.month - 1 >= SHRAWAN ? b.year : b.year - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

/** First and last English dates (inclusive) of a fiscal year like "2082/83". */
export function fiscalYearRange(fy: string): { from: string; to: string } {
  const m = /^(\d{4})\/(\d{2})$/.exec(fy);
  if (!m) throw new RangeError("Not a fiscal year");
  const start = Number(m[1]);
  const from = fromBs(start, SHRAWAN + 1, 1);
  const next = fromBs(start + 1, SHRAWAN + 1, 1);
  const [y, mo, d] = next.split("-").map(Number);
  const last = new Date(Date.UTC(y!, mo! - 1, d!) - 86_400_000);
  return { from, to: last.toISOString().slice(0, 10) };
}
