/**
 * Numbers for the dashboard charts. Pure functions, no I/O. Money is integer paisa. Hours and days are the business's own (its time zone).
 */
import { addDays, localDate } from "@/lib/business-day";

export interface MoneyEvent {
  at: Date;
  /** Positive for a sale, negative for a refund. */
  amount: number;
}

/** The hour (0 to 23) of an instant in a time zone. */
export function localHour(at: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(at);
  return Number(h) % 24;
}

/** Sales for each hour of one day: 24 numbers. Events on other days are ignored. */
export function hourBuckets(events: MoneyEvent[], timeZone: string, date: string): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const e of events) {
    if (localDate(e.at, timeZone) !== date) continue;
    out[localHour(e.at, timeZone)]! += e.amount;
  }
  return out;
}

export interface DayPoint {
  date: string;
  amount: number;
}

/** Sales for each of the `days` days ending on `endDate` (oldest first). */
export function dayBuckets(events: MoneyEvent[], timeZone: string, endDate: string, days: number): DayPoint[] {
  const points: DayPoint[] = Array.from({ length: days }, (_, i) => ({ date: addDays(endDate, i - (days - 1)), amount: 0 }));
  const index = new Map(points.map((p, i) => [p.date, i]));
  for (const e of events) {
    const i = index.get(localDate(e.at, timeZone));
    if (i !== undefined) points[i]!.amount += e.amount;
  }
  return points;
}

export interface WeekOverWeek {
  thisWeek: DayPoint[];
  lastWeek: DayPoint[];
  thisTotal: number;
  lastTotal: number;
  /** Percent change from last week to this one, one decimal, or null when last week had no sales. */
  changePercent: number | null;
}

/** The last 7 days against the 7 days before them. Needs 14 daily points, oldest first. */
export function weekOverWeek(daily: DayPoint[]): WeekOverWeek {
  const last = daily.slice(-7);
  const before = daily.slice(-14, -7);
  const sum = (p: DayPoint[]) => p.reduce((n, d) => n + d.amount, 0);
  const thisTotal = sum(last);
  const lastTotal = sum(before);
  return { thisWeek: last, lastWeek: before, thisTotal, lastTotal, changePercent: lastTotal > 0 ? Math.round(((thisTotal - lastTotal) / lastTotal) * 1000) / 10 : null };
}

export interface Slice {
  label: string;
  amount: number;
  /** Share of the total, one decimal. */
  percent: number;
}

const METHOD_LABEL: Record<string, string> = { CASH: "Cash", QR: "QR", CARD: "Card", CREDIT: "Credit" };

/** How customers paid: one slice per method that was used, biggest first. */
export function methodSlices(payments: { method: string; amount: number }[]): Slice[] {
  const by = new Map<string, number>();
  for (const p of payments) by.set(p.method, (by.get(p.method) ?? 0) + p.amount);
  const total = [...by.values()].reduce((n, v) => n + v, 0);
  return [...by.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([m, v]) => ({ label: METHOD_LABEL[m] ?? m, amount: v, percent: total > 0 ? Math.round((v / total) * 1000) / 10 : 0 }));
}

/** A short money label for a chart axis: Rs 950, Rs 12.5k, Rs 3.2L. */
export function shortMoney(paisa: number): string {
  const rs = Math.round(paisa / 100);
  const abs = Math.abs(rs);
  const sign = rs < 0 ? "-" : "";
  const trim = (v: number) => String(Math.round(v * 10) / 10).replace(/\.0$/, "");
  if (abs >= 10_000_000) return `${sign}Rs ${trim(abs / 10_000_000)}Cr`;
  if (abs >= 100_000) return `${sign}Rs ${trim(abs / 100_000)}L`;
  if (abs >= 1_000) return `${sign}Rs ${trim(abs / 1_000)}k`;
  return `${sign}Rs ${abs}`;
}

/** A top value for an axis that is easy to read: 1, 2, 2.5 or 5 times a power of ten above the largest value. */
export function niceMax(max: number): number {
  if (max <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}
