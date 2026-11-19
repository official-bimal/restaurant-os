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
export function supplierBillLines(amount: number, vat = 0, tds = 0): Line[] {
  return tidy([
    { key: "PURCHASES", debit: amount - vat, credit: 0 },
    { key: "VAT_INPUT", debit: vat, credit: 0 },
    // Tax deducted at source is owed to IRD, not to the supplier.
    { key: "PAYABLE", debit: 0, credit: amount - tds },
    { key: "TDS_PAYABLE", debit: 0, credit: tds },
  ]);
}

/** Paying a supplier. */
export function supplierPaymentLines(amount: number, method: string): Line[] {
  return tidy([
    { key: "PAYABLE", debit: amount, credit: 0 },
    { key: SUPPLIER_PAY_KEY[method] ?? "BANK", debit: 0, credit: amount },
  ]);
}

/** Which account a salary was paid from, from what the manager typed ("Cash", "Bank transfer", "eSewa"...). Anything unclear is cash. */
export function salaryPayKey(how: string): string {
  const t = how.toLowerCase();
  if (/bank|cheque|check|transfer|ips|connect/.test(t)) return "BANK";
  if (/qr|esewa|khalti|fonepay|wallet/.test(t)) return "WALLET";
  return "CASH";
}

/** A finalised payroll: wages are an expense now, owed to staff until paid. */
export function payrollLines(total: number): Line[] {
  return tidy([
    { key: "SALARIES", debit: total, credit: 0 },
    { key: "SALARY_PAYABLE", debit: 0, credit: total },
  ]);
}

/** Paying one person's salary. */
export function salaryPaidLines(amount: number, how: string): Line[] {
  return tidy([
    { key: "SALARY_PAYABLE", debit: amount, credit: 0 },
    { key: salaryPayKey(how), debit: 0, credit: amount },
  ]);
}

/** Cash moved in or out of the drawer by the cashier: where the other side goes depends on why. */
export function drawerMoveLines(kind: string, amount: number): Line[] {
  switch (kind) {
    case "BANK_DEPOSIT":
      return tidy([{ key: "BANK", debit: amount, credit: 0 }, { key: "CASH", debit: 0, credit: amount }]);
    case "OWNER_TAKES":
      return tidy([{ key: "DRAWINGS", debit: amount, credit: 0 }, { key: "CASH", debit: 0, credit: amount }]);
    case "OWNER_ADDS":
      return tidy([{ key: "CASH", debit: amount, credit: 0 }, { key: "CAPITAL", debit: 0, credit: amount }]);
    case "OTHER_IN":
      return tidy([{ key: "CASH", debit: amount, credit: 0 }, { key: "OTHER_INCOME", debit: 0, credit: amount }]);
    default:
      return tidy([{ key: "OTHER_EXPENSE", debit: amount, credit: 0 }, { key: "CASH", debit: 0, credit: amount }]);
  }
}

/** Cash found short or over at the count: the books are brought to the real count and the difference is kept in its own account. */
export function drawerDiffLines(diff: number): Line[] {
  return diff < 0
    ? tidy([{ key: "CASH_DIFF", debit: -diff, credit: 0 }, { key: "CASH", debit: 0, credit: -diff }])
    : tidy([{ key: "CASH", debit: diff, credit: 0 }, { key: "CASH_DIFF", debit: 0, credit: diff }]);
}

const TIP_MONEY: Record<string, string> = { CASH: "CASH", CARD: "CARD", QR: "WALLET" };

/** A tip taken from a customer: money in, owed to staff (not the business income). */
export function tipLines(amount: number, method: string): Line[] {
  return tidy([{ key: TIP_MONEY[method] ?? "CASH", debit: amount, credit: 0 }, { key: "TIPS_PAYABLE", debit: 0, credit: amount }]);
}

/** Tips shared out through payroll: the wages expense payroll will book for them is offset, so the business is not charged for staff money. */
export function tipPayoutLines(total: number): Line[] {
  return tidy([{ key: "TIPS_PAYABLE", debit: total, credit: 0 }, { key: "SALARIES", debit: 0, credit: total }]);
}

export function balanced(lines: { debit: number; credit: number }[]): boolean {
  return lines.reduce((n, l) => n + l.debit - l.credit, 0) === 0;
}
