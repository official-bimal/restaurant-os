import { localDate } from "@/lib/business-day";

/**
 * Hours and pay maths, pure. Time is in whole minutes, money in integer paisa. Pay is shown before any tax or
 * statutory deductions: this app does not work those out.
 */

export interface Shift {
  clockIn: Date;
  clockOut: Date;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}

/**
 * Split worked time into regular and overtime minutes. Each shift counts on the calendar day it started (in the
 * business's own time zone); minutes on one day beyond `overtimeAfterMinutes` are overtime.
 */
export function splitMinutes(shifts: Shift[], timeZone: string, overtimeAfterMinutes: number): { regular: number; overtime: number; total: number } {
  const byDay = new Map<string, number>();
  for (const s of shifts) {
    const day = localDate(s.clockIn, timeZone);
    byDay.set(day, (byDay.get(day) ?? 0) + minutesBetween(s.clockIn, s.clockOut));
  }
  let regular = 0;
  let overtime = 0;
  for (const minutes of byDay.values()) {
    regular += Math.min(minutes, overtimeAfterMinutes);
    overtime += Math.max(0, minutes - overtimeAfterMinutes);
  }
  return { regular, overtime, total: regular + overtime };
}

export interface PayTerms {
  payType: "NONE" | "HOURLY" | "MONTHLY";
  /** Paisa per hour (HOURLY) or per month (MONTHLY). */
  rate: number;
  /** Overtime multiplier in basis points (15000 = 1.5 times). */
  overtimeBps: number;
}

export interface PayResult {
  basePay: number;
  overtimePay: number;
}

/**
 * Pay for one month. HOURLY: regular minutes at the rate, overtime minutes at the rate times the multiplier, each rounded
 * to the paisa. MONTHLY: the fixed salary (hours are recorded but do not change it). NONE: nothing.
 */
export function computePay(terms: PayTerms, minutes: { regular: number; overtime: number }): PayResult {
  if (terms.payType === "MONTHLY") return { basePay: terms.rate, overtimePay: 0 };
  if (terms.payType === "NONE") return { basePay: 0, overtimePay: 0 };
  const basePay = Math.round((minutes.regular * terms.rate) / 60);
  const overtimePay = Math.round((minutes.overtime * terms.rate * terms.overtimeBps) / (60 * 10_000));
  return { basePay, overtimePay };
}

export type AdjustKind = "ALLOWANCE" | "BONUS" | "ADVANCE" | "DEDUCTION";

/** Allowances and bonuses add; advances and deductions take off. */
export function sumAdjustments(adjustments: { kind: AdjustKind; amount: number }[]): { additions: number; deductions: number } {
  let additions = 0;
  let deductions = 0;
  for (const a of adjustments) {
    if (a.kind === "ALLOWANCE" || a.kind === "BONUS") additions += a.amount;
    else deductions += a.amount;
  }
  return { additions, deductions };
}

export const netPay = (r: PayResult, adj: { additions: number; deductions: number }) =>
  r.basePay + r.overtimePay + adj.additions - adj.deductions;

/** The first and last day of a YYYY-MM month. */
export function monthBounds(period: string): { start: string; end: string } {
  const [y, m] = [Number(period.slice(0, 4)), Number(period.slice(5, 7))];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, "0")}` };
}

export const isPeriod = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function formatHours(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** What the wall clock in `timeZone` reads at `instant`, as if it were UTC (to find the zone's offset). */
function wallClockAsUtc(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
}

/**
 * Turns what a person typed in a date-and-time box ("2026-06-01T09:30", no zone) into the real instant, reading it as
 * the business's own local time. Returns null if it is not a valid date and time.
 */
export function parseLocalDateTime(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(naive);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  // Two passes handle zones whose offset changes (daylight saving) near the instant.
  let guess = naive - (wallClockAsUtc(new Date(naive), timeZone) - naive);
  guess = naive - (wallClockAsUtc(new Date(guess), timeZone) - guess);
  return new Date(guess);
}

/** The inverse, for filling a date-and-time box: the business's local time as "YYYY-MM-DDTHH:mm". */
export function toLocalInput(instant: Date, timeZone: string): string {
  const t = new Date(wallClockAsUtc(instant, timeZone));
  return t.toISOString().slice(0, 16);
}
