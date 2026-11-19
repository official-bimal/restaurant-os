/**
 * How the day-to-day events of the restaurant become double-entry lines. Pure functions: each returns the lines (by the system key of the
 * account) for one sale, refund, supplier bill or supplier payment. Every set of lines balances (debits equal credits) by construction:
 * the sales line is whatever is left after the other parts of the bill are taken out.
 */
export interface Line {
  /** System key of the account, see chart.ts. */
  key: string;
  debit: number;
  credit: number;
  narration?: string;
}

const PAY_KEY: Record<string, string> = { CASH: "CASH", CARD: "CARD", QR: "WALLET", CREDIT: "RECEIVABLE" };
const SUPPLIER_PAY_KEY: Record<string, string> = { CASH: "CASH", BANK: "BANK", CHEQUE: "BANK", QR: "WALLET", OTHER: "BANK" };

function tidy(lines: Line[]): Line[] {
  return lines.filter((l) => l.debit !== 0 || l.credit !== 0);
}

function put(lines: Line[], key: string, signed: number, side: "debit" | "credit") {
  if (signed === 0) return;
  const other = side === "debit" ? "credit" : "debit";
  lines.push(signed > 0 ? { key, [side]: signed, [other]: 0 } as unknown as Line : { key, [other]: -signed, [side]: 0 } as unknown as Line);
}

export interface SaleInput {
  grandTotal: number;
  serviceCharge: number;
  vat: number;
  deliveryFee: number;
  roundOff: number;
  payments: { method: string; amount: number }[];
}

/** A paid bill: money in, and income, service charge, delivery fee and output VAT out. */
export function saleLines(s: SaleInput): Line[] {
  const lines: Line[] = [];
  let received = 0;
  for (const p of s.payments) {
    received += p.amount;
    lines.push({ key: PAY_KEY[p.method] ?? "CASH", debit: p.amount, credit: 0 });
  }
  // Anything not paid in full is owed by the customer.
  if (received < s.grandTotal) lines.push({ key: "RECEIVABLE", debit: s.grandTotal - received, credit: 0 });
  const total = Math.max(received, s.grandTotal);
  put(lines, "SERVICE_CHARGE", s.serviceCharge, "credit");
  put(lines, "VAT_OUTPUT", s.vat, "credit");
  put(lines, "DELIVERY", s.deliveryFee, "credit");
  put(lines, "ROUND_OFF", s.roundOff, "credit");
  const sales = total - s.serviceCharge - s.vat - s.deliveryFee - s.roundOff;
  put(lines, "SALES", sales, "credit");
  return tidy(lines);
}

export interface RefundInput {
  grandTotal: number;
  serviceCharge: number;
  vat: number;
  roundOff: number;
  refunds: { method: string; amount: number }[];
}

/** A credit note: the sale taken back, and the money paid back out. */
export function refundLines(r: RefundInput): Line[] {
  const lines: Line[] = [];
  let paid = 0;
  for (const p of r.refunds) {
    paid += p.amount;
    lines.push({ key: PAY_KEY[p.method] ?? "CASH", debit: 0, credit: p.amount });
  }
  if (paid < r.grandTotal) lines.push({ key: "RECEIVABLE", debit: 0, credit: r.grandTotal - paid });
  const total = Math.max(paid, r.grandTotal);
  put(lines, "SERVICE_CHARGE", r.serviceCharge, "debit");
  put(lines, "VAT_OUTPUT", r.vat, "debit");
  put(lines, "ROUND_OFF", r.roundOff, "debit");
  put(lines, "SALES_RETURNS", total - r.serviceCharge - r.vat - r.roundOff, "debit");
  return tidy(lines);
}

/** A supplier's bill: what we bought, and that we now owe for it. */
export function supplierBillLines(amount: number, vat = 0): Line[] {
  return tidy([
    { key: "PURCHASES", debit: amount - vat, credit: 0 },
    { key: "VAT_INPUT", debit: vat, credit: 0 },
    { key: "PAYABLE", debit: 0, credit: amount },
  ]);
}

/** Paying a supplier. */
export function supplierPaymentLines(amount: number, method: string): Line[] {
  return tidy([
    { key: "PAYABLE", debit: amount, credit: 0 },
    { key: SUPPLIER_PAY_KEY[method] ?? "BANK", debit: 0, credit: amount },
  ]);
}

export function balanced(lines: { debit: number; credit: number }[]): boolean {
  return lines.reduce((n, l) => n + l.debit - l.credit, 0) === 0;
}
