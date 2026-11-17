/**
 * Supplier bill maths, pure. A bill is what a supplier is owed; payments reduce it. Money is integer paisa and dates
 * are YYYY-MM-DD strings in the business's own calendar.
 */

export type BillStatus = "VOID" | "PAID" | "PARTIAL" | "UNPAID";

export function billStatus(bill: { amount: number; paid: number; voided: boolean }): BillStatus {
  if (bill.voided) return "VOID";
  if (bill.paid >= bill.amount) return "PAID";
  return bill.paid > 0 ? "PARTIAL" : "UNPAID";
}

/** What is still to pay on a bill (never negative; nothing on a voided bill). */
export function outstanding(bill: { amount: number; paid: number; voided: boolean }): number {
  return bill.voided ? 0 : Math.max(0, bill.amount - bill.paid);
}

const DAY = 24 * 60 * 60 * 1000;
const asDay = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** Whole days between two YYYY-MM-DD dates (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((asDay(to) - asDay(from)) / DAY);
}

export type AgeBucket = "NOT_DUE" | "DAYS_1_30" | "DAYS_31_60" | "OVER_60";

/** How late an unpaid bill is, by its due date (a bill with no due date counts as not due). */
export function ageBucket(dueDate: string | null, today: string): AgeBucket {
  if (!dueDate) return "NOT_DUE";
  const late = daysBetween(dueDate, today);
  if (late <= 0) return "NOT_DUE";
  if (late <= 30) return "DAYS_1_30";
  if (late <= 60) return "DAYS_31_60";
  return "OVER_60";
}

export interface PayableRow {
  supplierId: string;
  outstanding: number;
  overdue: number;
  buckets: Record<AgeBucket, number>;
}

/** Group open bills by supplier into what is owed, what is overdue, and how overdue. */
export function summarizePayables(
  bills: { supplierId: string; amount: number; paid: number; voided: boolean; dueDate: string | null }[],
  today: string,
): PayableRow[] {
  const by = new Map<string, PayableRow>();
  for (const b of bills) {
    const left = outstanding(b);
    if (left <= 0) continue;
    const row = by.get(b.supplierId) ?? {
      supplierId: b.supplierId,
      outstanding: 0,
      overdue: 0,
      buckets: { NOT_DUE: 0, DAYS_1_30: 0, DAYS_31_60: 0, OVER_60: 0 },
    };
    const bucket = ageBucket(b.dueDate, today);
    row.outstanding += left;
    row.buckets[bucket] += left;
    if (bucket !== "NOT_DUE") row.overdue += left;
    by.set(b.supplierId, row);
  }
  return [...by.values()].sort((a, b) => b.outstanding - a.outstanding);
}
