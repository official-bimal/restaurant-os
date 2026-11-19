/**
 * Roster and tip-sharing maths. Pure functions, no I/O. Weeks run Sunday to Saturday, as in Nepal.
 */
import { addDays } from "@/lib/business-day";

/** The Sunday on or before a date (YYYY-MM-DD). */
export function weekStartOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -day);
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Minutes worked in a shift. An end earlier than the start runs past midnight; the same start and end is not a shift. */
export function shiftMinutes(start: string, end: string): number {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return 0;
  return e > s ? e - s : 24 * 60 - s + e;
}

/** The part of a day (minutes from midnight) a shift covers on its own date, and the part that spills into the next day. */
function span(start: string, end: string): { today: [number, number]; spill: number } {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return e > s ? { today: [s, e], spill: 0 } : { today: [s, 24 * 60], spill: e };
}

/** Whether two shifts of one person clash: on the same date they overlap, or one runs past midnight into the other's early morning the next day. */
export function clashes(a: { date: string; start: string; end: string }, b: { date: string; start: string; end: string }): boolean {
  const overlap = (x: [number, number], y: [number, number]) => x[0] < y[1] && y[0] < x[1];
  if (a.date === b.date) return overlap(span(a.start, a.end).today, span(b.start, b.end).today);
  const spillInto = (from: typeof a, to: typeof a) => addDays(from.date, 1) === to.date && span(from.start, from.end).spill > 0 && overlap([0, span(from.start, from.end).spill], span(to.start, to.end).today);
  return spillInto(a, b) || spillInto(b, a);
}

export interface Worker {
  userId: string;
  name: string;
  minutes: number;
}

/**
 * Shares a pool among people. By hours: in proportion to minutes worked. Equally: the same for everyone who worked at all. Always adds up to the
 * pool exactly: what is left after rounding down goes, a paisa each, to those with the largest remainders.
 */
export function shareOut(pool: number, workers: Worker[], basis: "HOURS" | "EQUAL"): { userId: string; name: string; minutes: number; amount: number }[] {
  const people = workers.filter((w) => w.minutes > 0);
  if (pool <= 0 || people.length === 0) return people.map((p) => ({ ...p, amount: 0 }));
  const weights = people.map((p) => (basis === "HOURS" ? p.minutes : 1));
  const total = weights.reduce((n, w) => n + w, 0);
  const exact = weights.map((w) => (pool * w) / total);
  const amounts = exact.map((x) => Math.floor(x));
  let left = pool - amounts.reduce((n, a) => n + a, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    amounts[o.i]! += 1;
    left--;
  }
  return people.map((p, i) => ({ ...p, amount: amounts[i]! }));
}
