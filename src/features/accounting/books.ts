/**
 * The books, worked out from journal lines: trial balance, ledger, profit and loss, balance sheet. Pure functions, no I/O.
 * Money is integer paisa. A "balance" is positive in the account's normal direction (debits for assets and expenses, credits for the rest).
 */
import { debitNormal, type AccountType } from "./chart";

export interface AccountInfo {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

export interface PostedLine {
  accountId: string;
  /** YYYY-MM-DD */
  date: string;
  debit: number;
  credit: number;
}

export function signed(type: AccountType, debit: number, credit: number): number {
  return debitNormal(type) ? debit - credit : credit - debit;
}

export interface TrialRow {
  account: AccountInfo;
  debit: number;
  credit: number;
}

/** Every account with activity, shown as one closing balance on its natural side. */
export function trialBalance(accounts: AccountInfo[], lines: PostedLine[]): { rows: TrialRow[]; totalDebit: number; totalCredit: number } {
  const sums = new Map<string, { d: number; c: number }>();
  for (const l of lines) {
    const s = sums.get(l.accountId) ?? { d: 0, c: 0 };
    s.d += l.debit;
    s.c += l.credit;
    sums.set(l.accountId, s);
  }
  const rows: TrialRow[] = [];
  for (const a of [...accounts].sort((x, y) => x.code.localeCompare(y.code))) {
    const s = sums.get(a.id);
    if (!s || (s.d === 0 && s.c === 0)) continue;
    const net = s.d - s.c;
    rows.push({ account: a, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 });
  }
  return { rows, totalDebit: rows.reduce((n, r) => n + r.debit, 0), totalCredit: rows.reduce((n, r) => n + r.credit, 0) };
}

export interface LedgerLine {
  entryId: string;
  date: string;
  number: string;
  narration: string;
  debit: number;
  credit: number;
}

/** One account's page: the balance brought forward, then every line with a running balance. */
export function ledger(type: AccountType, opening: { debit: number; credit: number }, lines: LedgerLine[]) {
  let running = signed(type, opening.debit, opening.credit);
  const brought = running;
  const rows = lines.map((l) => {
    running += signed(type, l.debit, l.credit);
    return { ...l, balance: running };
  });
  return {
    broughtForward: brought,
    rows,
    totalDebit: lines.reduce((n, l) => n + l.debit, 0),
    totalCredit: lines.reduce((n, l) => n + l.credit, 0),
    closing: running,
  };
}

export interface Section {
  rows: { account: AccountInfo; amount: number }[];
  total: number;
}

function section(accounts: AccountInfo[], lines: PostedLine[], type: AccountType): Section {
  const rows = accounts
    .filter((a) => a.type === type)
    .map((a) => {
      let d = 0;
      let c = 0;
      for (const l of lines) {
        if (l.accountId === a.id) {
          d += l.debit;
          c += l.credit;
        }
      }
      return { account: a, amount: signed(type, d, c), used: d !== 0 || c !== 0 };
    })
    .filter((r) => r.used)
    .sort((x, y) => x.account.code.localeCompare(y.account.code))
    .map(({ account, amount }) => ({ account, amount }));
  return { rows, total: rows.reduce((n, r) => n + r.amount, 0) };
}

/** Profit and loss for the lines given (already limited to the period). */
export function profitAndLoss(accounts: AccountInfo[], lines: PostedLine[]) {
  const income = section(accounts, lines, "INCOME");
  const expenses = section(accounts, lines, "EXPENSE");
  return { income, expenses, profit: income.total - expenses.total };
}

/** Balance sheet at the end of the lines given (all lines up to the date). Profit so far is shown inside equity. */
export function balanceSheet(accounts: AccountInfo[], lines: PostedLine[]) {
  const assets = section(accounts, lines, "ASSET");
  const liabilities = section(accounts, lines, "LIABILITY");
  const equity = section(accounts, lines, "EQUITY");
  const { profit } = profitAndLoss(accounts, lines);
  const equityTotal = equity.total + profit;
  return {
    assets,
    liabilities,
    equity,
    profit,
    equityTotal,
    /** Zero when the books agree: assets equal liabilities plus equity. */
    difference: assets.total - liabilities.total - equityTotal,
  };
}
