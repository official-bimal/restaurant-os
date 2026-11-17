import { formatNpr } from "@/features/billing/calc";

/**
 * The owner's suspicious-activity rules. Pure: given one day's facts and the owner's thresholds, they say what is worth a
 * look. Nothing here accuses anyone: an alert is a prompt to check, and the wording says what was counted, not why.
 */

export interface Thresholds {
  alertVoidCount: number;
  alertVoidAmount: number;
  alertDiscountPct: number;
  alertDiscountShareBps: number;
  alertRefundAmount: number;
  alertCashDiff: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  alertVoidCount: 3,
  alertVoidAmount: 500_000,
  alertDiscountPct: 20,
  alertDiscountShareBps: 1000,
  alertRefundAmount: 500_000,
  alertCashDiff: 10_000,
};

export interface DayFacts {
  date: string;
  /** Cancelled bills that had food on them. */
  voids: { count: number; amount: number };
  /** Every bill paid that day: its number, what it was before discount (subtotal) and the discount given. */
  invoices: { id: string; number: number; subtotal: number; discount: number }[];
  refunds: { id: string; number: number; invoiceNumber: number; amount: number; partial: boolean }[];
  /** Day-close cash differences (counted minus expected), one per branch that closed. */
  cashDiffs: { branch: string; difference: number }[];
}

export type AlertKind = "VOIDS" | "VOID_AMOUNT" | "DISCOUNT_BILL" | "DISCOUNT_SHARE" | "REFUND" | "CASH_DIFFERENCE";

export interface Candidate {
  kind: AlertKind;
  /** Tells two alerts of the same kind on one day apart (the bill, the branch). Empty when there can only be one. */
  key: string;
  title: string;
  detail: string;
  level: "alert" | "warn";
}

export const ALERT_LABEL: Record<AlertKind, string> = {
  VOIDS: "Cancelled bills",
  VOID_AMOUNT: "Value of cancelled bills",
  DISCOUNT_BILL: "Large discount on a bill",
  DISCOUNT_SHARE: "Discounts are a big share of sales",
  REFUND: "Large refund",
  CASH_DIFFERENCE: "Cash does not match",
};

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

export function evaluateRules(f: DayFacts, t: Thresholds): Candidate[] {
  const out: Candidate[] = [];

  if (t.alertVoidCount > 0 && f.voids.count >= t.alertVoidCount) {
    out.push({
      kind: "VOIDS",
      key: "",
      title: `${f.voids.count} bills were cancelled`,
      detail: `${f.voids.count} bills with food on them were cancelled on ${f.date} (your limit is ${t.alertVoidCount}). Check the reasons under Bills.`,
      level: "warn",
    });
  }
  if (t.alertVoidAmount > 0 && f.voids.amount >= t.alertVoidAmount) {
    out.push({
      kind: "VOID_AMOUNT",
      key: "",
      title: `${formatNpr(f.voids.amount)} of bills cancelled`,
      detail: `Cancelled bills added up to ${formatNpr(f.voids.amount)} on ${f.date} (your limit is ${formatNpr(t.alertVoidAmount)}).`,
      level: "alert",
    });
  }

  let discounts = 0;
  let before = 0;
  for (const i of f.invoices) {
    discounts += i.discount;
    before += i.subtotal;
    if (t.alertDiscountPct > 0 && i.discount > 0 && i.subtotal > 0 && (i.discount * 100) / i.subtotal >= t.alertDiscountPct) {
      const p = Math.round((i.discount * 1000) / i.subtotal) / 10;
      out.push({
        kind: "DISCOUNT_BILL",
        key: i.id,
        title: `${p}% discount on invoice #${i.number}`,
        detail: `Invoice #${i.number} had a discount of ${formatNpr(i.discount)} on ${formatNpr(i.subtotal)} (${p}%; your limit is ${t.alertDiscountPct}%).`,
        level: "warn",
      });
    }
  }
  if (t.alertDiscountShareBps > 0 && before > 0 && discounts > 0 && (discounts * 10_000) / before >= t.alertDiscountShareBps) {
    const share = Math.round((discounts * 10_000) / before);
    out.push({
      kind: "DISCOUNT_SHARE",
      key: "",
      title: `Discounts were ${pct(share)} of sales`,
      detail: `${formatNpr(discounts)} was given in discounts against ${formatNpr(before)} of sales on ${f.date} (your limit is ${pct(t.alertDiscountShareBps)}).`,
      level: "warn",
    });
  }

  if (t.alertRefundAmount > 0) {
    for (const r of f.refunds) {
      if (r.amount >= t.alertRefundAmount) {
        out.push({
          kind: "REFUND",
          key: r.id,
          title: `${formatNpr(r.amount)} refunded on invoice #${r.invoiceNumber}`,
          detail: `Credit note #${r.number}${r.partial ? " (part refund)" : ""} returned ${formatNpr(r.amount)} (your limit is ${formatNpr(t.alertRefundAmount)}).`,
          level: "alert",
        });
      }
    }
  }

  if (t.alertCashDiff > 0) {
    for (const c of f.cashDiffs) {
      if (Math.abs(c.difference) >= t.alertCashDiff) {
        out.push({
          kind: "CASH_DIFFERENCE",
          key: c.branch,
          title: `${c.branch}: cash ${c.difference < 0 ? "short" : "over"} by ${formatNpr(Math.abs(c.difference))}`,
          detail: `At day close on ${f.date} the counted cash was ${formatNpr(Math.abs(c.difference))} ${c.difference < 0 ? "less" : "more"} than it should be (your limit is ${formatNpr(t.alertCashDiff)}).`,
          level: "alert",
        });
      }
    }
  }
  return out;
}
