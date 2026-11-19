/**
 * The plain-words view of the books: every voucher as a Sale, Purchase, Income, Expense, Payment In, Payment Out or Transfer.
 * Pure functions, no I/O. Money is integer paisa.
 */

export type TxType = "SALES" | "SALES_RETURN" | "PURCHASE" | "INCOME" | "EXPENSE" | "PAYMENT_IN" | "PAYMENT_OUT" | "TRANSFER" | "JOURNAL";

export const TX_LABEL: Record<TxType, string> = {
  SALES: "Sales",
  SALES_RETURN: "Sales return",
  PURCHASE: "Purchase",
  INCOME: "Income",
  EXPENSE: "Expense",
  PAYMENT_IN: "Payment in",
  PAYMENT_OUT: "Payment out",
  TRANSFER: "Transfer",
  JOURNAL: "Journal",
};

export const EASY_KINDS = ["INCOME", "EXPENSE", "PAYMENT_IN", "PAYMENT_OUT", "TRANSFER"] as const;
export type EasyKind = (typeof EASY_KINDS)[number];

/** What kind of transaction a journal entry is, from how it was made. */
export function classify(e: { voucher: string; entryKind: string | null }): TxType {
  if (e.entryKind && (EASY_KINDS as readonly string[]).includes(e.entryKind)) return e.entryKind as TxType;
  switch (e.voucher) {
    case "SALE":
      return "SALES";
    case "REFUND":
      return "SALES_RETURN";
    case "PURCHASE":
      return "PURCHASE";
    case "SUPPLIER_PAYMENT":
    case "SALARY_PAID":
      return "PAYMENT_OUT";
    case "PAYROLL":
      return "EXPENSE";
    default:
      return "JOURNAL";
  }
}

export interface EasyInput {
  amount: number;
  /** The cash, bank or wallet account the money moved through (the "from" account for a transfer). */
  money: string;
  /** Income and expense: the income or expense account. Payment in and out: the receivable or payable account. */
  other?: string;
  /** A transfer: the account the money went to. */
  to?: string;
}

/** The debit and credit lines for an easy entry. Always balanced. */
export function easyLines(kind: EasyKind, i: EasyInput): { accountId: string; debit: number; credit: number }[] {
  const dr = (accountId: string) => ({ accountId, debit: i.amount, credit: 0 });
  const cr = (accountId: string) => ({ accountId, debit: 0, credit: i.amount });
  switch (kind) {
    case "INCOME":
    case "PAYMENT_IN":
      return [dr(i.money), cr(i.other!)];
    case "EXPENSE":
    case "PAYMENT_OUT":
      return [dr(i.other!), cr(i.money)];
    case "TRANSFER":
      return [dr(i.to!), cr(i.money)];
  }
}

/** The voucher kind an easy entry is kept under (what the daybook and the old screens call it). */
export function voucherFor(kind: EasyKind): "RECEIPT" | "PAYMENT" | "CONTRA" {
  return kind === "INCOME" || kind === "PAYMENT_IN" ? "RECEIPT" : kind === "TRANSFER" ? "CONTRA" : "PAYMENT";
}

export interface TxRow {
  type: TxType;
  amount: number;
  /** Taken back by a reversal: it counts for nothing. */
  reversed: boolean;
}

export interface Cards {
  sales: number;
  purchase: number;
  income: number;
  expenses: number;
  paymentIn: number;
  paymentOut: number;
}

/** The six totals above the list. Sales are net of returns; reversed entries are left out. */
export function cardTotals(rows: TxRow[]): Cards {
  const c: Cards = { sales: 0, purchase: 0, income: 0, expenses: 0, paymentIn: 0, paymentOut: 0 };
  for (const r of rows) {
    if (r.reversed) continue;
    if (r.type === "SALES") c.sales += r.amount;
    else if (r.type === "SALES_RETURN") c.sales -= r.amount;
    else if (r.type === "PURCHASE") c.purchase += r.amount;
    else if (r.type === "INCOME") c.income += r.amount;
    else if (r.type === "EXPENSE") c.expenses += r.amount;
    else if (r.type === "PAYMENT_IN") c.paymentIn += r.amount;
    else if (r.type === "PAYMENT_OUT") c.paymentOut += r.amount;
  }
  return c;
}

/** The row of the cash book a line on a money account belongs to: a debit is money in, a credit is money out. */
export function cashBookRow(type: TxType, side: "IN" | "OUT"): string {
  if (side === "IN") {
    switch (type) {
      case "SALES":
        return "Net sales";
      case "INCOME":
        return "Income";
      case "PAYMENT_IN":
        return "Payment in";
      case "TRANSFER":
        return "Transfer in";
      case "PURCHASE":
        return "Purchase return";
      default:
        return "Other receipts";
    }
  }
  switch (type) {
    case "PURCHASE":
      return "Purchase";
    case "SALES_RETURN":
      return "Sales return";
    case "PAYMENT_OUT":
      return "Payment out";
    case "EXPENSE":
      return "Expenses";
    case "TRANSFER":
      return "Transfer out";
    default:
      return "Other payments";
  }
}

export const RECEIPT_ROWS = ["Net sales", "Income", "Payment in", "Transfer in", "Purchase return", "Other receipts"] as const;
export const PAYMENT_ROWS = ["Purchase", "Sales return", "Payment out", "Expenses", "Transfer out", "Other payments"] as const;
