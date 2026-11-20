import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { isValidDate, localDate } from "@/lib/business-day";
import { signed } from "../books";
import { cardTotals, cashBookRow, classify, easyLines, EASY_KINDS, PAYMENT_ROWS, RECEIPT_ROWS, TX_LABEL, voucherFor, type Cards, type EasyKind, type TxType } from "../transactions";
import { createVoucher, ensureChart, syncPostings } from "./service";

/**
 * The plain-words side of the books: easy entries (income, expense, payment in, payment out, transfer), the money accounts (cash, banks,
 * wallets), the Transactions list and the cash book by account. Reading needs `books.view`; making an entry or adding an account needs `books.manage`.
 * Every query is filtered by businessId.
 */

function needView(ctx: TenantContext) {
  if (!can(ctx, "books.view")) throw new DomainError("You do not have permission to see the accounts.");
}
function needManage(ctx: TenantContext) {
  if (!can(ctx, "books.manage")) throw new DomainError("Only the owner can change the accounts.");
}

// ---------------------------------------------------------------------------------------------------
// money accounts

/** Cash, banks and wallets, each with what it holds now. */
export async function listMoneyAccounts(ctx: TenantContext) {
  needView(ctx);
  await ensureChart(ctx.businessId);
  await syncPostings(ctx.businessId);
  const accounts = await db.account.findMany({ where: { businessId: ctx.businessId, moneyAccount: true }, orderBy: { code: "asc" } });
  const sums = await db.journalLine.groupBy({ by: ["accountId"], where: { businessId: ctx.businessId, accountId: { in: accounts.map((a) => a.id) } }, _sum: { debit: true, credit: true } });
  const by = new Map(sums.map((s) => [s.accountId, s._sum]));
  return accounts.map((a) => ({ ...a, balance: signed(a.type, by.get(a.id)?.debit ?? 0, by.get(a.id)?.credit ?? 0) }));
}

/** A new bank, cash box or wallet. It gets the next free code in the 1060 to 1099 range. */
export async function addMoneyAccount(ctx: TenantContext, input: { name: string }) {
  needManage(ctx);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) throw new DomainError("Give the account a name (60 characters at most).");
  await ensureChart(ctx.businessId);
  return db.$transaction(async (tx) => {
    const taken = new Set((await tx.account.findMany({ where: { businessId: ctx.businessId, code: { gte: "1060", lte: "1099" } }, select: { code: true } })).map((a) => a.code));
    let code = "";
    for (let n = 1060; n <= 1099; n++) if (!taken.has(String(n))) { code = String(n); break; }
    if (!code) throw new DomainError("There is no room for another money account.");
    const a = await tx.account.create({ data: { businessId: ctx.businessId, code, name, type: "ASSET", moneyAccount: true } });
    await audit(tx, ctx, "account.createMoney", "Account", a.id, { name });
    return a;
  });
}

// ---------------------------------------------------------------------------------------------------
// easy entries

export interface EasyEntryInput {
  kind: string;
  date: string;
  amount: number;
  moneyAccountId: string;
  /** Income or expense account (income and expense), or the second money account (transfer). */
  otherAccountId?: string;
  party?: string;
  note?: string;
}

/** One line in plain words, posted to the books as a balanced voucher. */
export async function createEasyEntry(ctx: TenantContext, input: EasyEntryInput) {
  needManage(ctx);
  if (!(EASY_KINDS as readonly string[]).includes(input.kind)) throw new DomainError("Choose what kind of entry this is.");
  const kind = input.kind as EasyKind;
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > 100_000_000_000) throw new DomainError("Enter the amount as a number above zero.");
  if (!isValidDate(input.date)) throw new DomainError("Choose a valid date.");
  const party = (input.party ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  await ensureChart(ctx.businessId);

  const accounts = await db.account.findMany({ where: { businessId: ctx.businessId, id: { in: [input.moneyAccountId, ...(input.otherAccountId ? [input.otherAccountId] : [])] } } });
  const money = accounts.find((a) => a.id === input.moneyAccountId);
  if (!money || !money.moneyAccount || !money.active) throw new DomainError("Choose the cash, bank or wallet account.");
  const other = input.otherAccountId ? accounts.find((a) => a.id === input.otherAccountId) : undefined;

  let otherId: string | undefined;
  let toId: string | undefined;
  let narration: string;
  if (kind === "INCOME" || kind === "EXPENSE") {
    const want = kind === "INCOME" ? "INCOME" : "EXPENSE";
    if (!other || other.type !== want || !other.active) throw new DomainError(kind === "INCOME" ? "Choose the income account." : "Choose the expense account.");
    otherId = other.id;
    narration = `${kind === "INCOME" ? "Income" : "Expense"}: ${other.name}${party ? ` (${party})` : ""}`;
  } else if (kind === "TRANSFER") {
    if (!other || !other.moneyAccount || !other.active) throw new DomainError("Choose the account the money goes to.");
    if (other.id === money.id) throw new DomainError("Choose two different accounts.");
    toId = other.id;
    narration = `Transfer from ${money.name} to ${other.name}`;
  } else {
    const key = kind === "PAYMENT_IN" ? "RECEIVABLE" : "PAYABLE";
    const acc = await db.account.findFirst({ where: { businessId: ctx.businessId, key } });
    if (!acc) throw new DomainError("The chart of accounts is missing an account this needs.");
    otherId = acc.id;
    narration = kind === "PAYMENT_IN" ? `Payment received${party ? ` from ${party}` : ""}` : `Payment made${party ? ` to ${party}` : ""}`;
  }
  const note = (input.note ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (note) narration = `${narration}. ${note}`.slice(0, 200);

  return createVoucher(ctx, {
    voucher: voucherFor(kind),
    date: input.date,
    narration,
    entryKind: kind,
    party: party || undefined,
    lines: easyLines(kind, { amount: input.amount, money: money.id, other: otherId, to: toId }),
  });
}

/** What the easy forms need to fill their pickers. */
export async function getEasyOptions(ctx: TenantContext) {
  needView(ctx);
  await ensureChart(ctx.businessId);
  const [money, income, expense] = await Promise.all([
    listMoneyAccounts(ctx),
    // The accounts the till posts sales to are not for typing income into; every other income account is.
    db.account.findMany({ where: { businessId: ctx.businessId, type: "INCOME", active: true, OR: [{ key: null }, { key: { notIn: ["SALES", "SERVICE_CHARGE", "DELIVERY", "SALES_RETURNS", "ROUND_OFF"] } }] }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.account.findMany({ where: { businessId: ctx.businessId, type: "EXPENSE", active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const today = localDate(new Date(), (await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } })).timezone);
  return { money: money.filter((m) => m.active), income, expense, today };
}

// ---------------------------------------------------------------------------------------------------
// the Transactions list

export interface TxFilters {
  from: string;
  to: string;
  type?: string;
  moneyAccountId?: string;
  q?: string;
  status?: string;
}

export interface TxListRow {
  id: string;
  date: string;
  number: string;
  type: TxType;
  typeLabel: string;
  particular: string;
  party: string | null;
  /** The cash, bank or wallet accounts it went through. */
  mode: string;
  amount: number;
  reversed: boolean;
  by: string;
}

const SHOWN = 300;

export async function listTransactions(ctx: TenantContext, f: TxFilters): Promise<{ rows: TxListRow[]; cards: Cards; total: number; shown: number }> {
  needView(ctx);
  if (!isValidDate(f.from) || !isValidDate(f.to)) throw new DomainError("Choose valid dates.");
  if (f.from > f.to) throw new DomainError("The start date is after the end date.");
  await syncPostings(ctx.businessId);
  const q = (f.q ?? "").trim().toLowerCase();
  const entries = await db.journalEntry.findMany({
    where: {
      businessId: ctx.businessId,
      date: { gte: f.from, lte: f.to },
      ...(f.moneyAccountId ? { lines: { some: { accountId: f.moneyAccountId } } } : {}),
    },
    include: { lines: { include: { account: { select: { name: true, moneyAccount: true } } } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 2000,
  });
  const reversedIds = new Set(entries.map((e) => e.reversesId).filter(Boolean) as string[]);
  const users = await db.user.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.createdById).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const all: TxListRow[] = entries.map((e) => {
    const type = classify(e);
    const modes = [...new Set(e.lines.filter((l) => l.account.moneyAccount).map((l) => l.account.name))];
    return {
      id: e.id,
      date: e.date,
      number: `${e.fiscalYear} #${e.number}`,
      type,
      typeLabel: TX_LABEL[type],
      particular: e.narration,
      party: e.party,
      mode: modes.length ? modes.join(" → ") : "-",
      amount: e.lines.reduce((n, l) => n + l.debit, 0),
      reversed: reversedIds.has(e.id),
      by: e.createdById ? (nameOf.get(e.createdById) ?? "Unknown") : "System",
    };
  });
  // The totals follow the filters except the type: they are the totals of what you are looking at.
  const filtered = all.filter(
    (r) =>
      (!q || r.particular.toLowerCase().includes(q) || (r.party ?? "").toLowerCase().includes(q) || r.number.toLowerCase().includes(q)) &&
      (!f.status || (f.status === "reversed" ? r.reversed : !r.reversed)),
  );
  const cards = cardTotals(filtered.map((r) => ({ type: r.type, amount: r.amount, reversed: r.reversed })));
  const typed = f.type ? filtered.filter((r) => r.type === f.type) : filtered;
  return { rows: typed.slice(0, SHOWN), cards, total: typed.length, shown: Math.min(SHOWN, typed.length) };
}

// ---------------------------------------------------------------------------------------------------
// cash and banks: the cash book by account

export interface CashBook {
  accounts: { id: string; name: string }[];
  opening: Record<string, number>;
  receipts: { row: string; byAccount: Record<string, number>; total: number }[];
  payments: { row: string; byAccount: Record<string, number>; total: number }[];
  receiptsTotal: { byAccount: Record<string, number>; all: number };
  paymentsTotal: { byAccount: Record<string, number>; all: number };
  closing: Record<string, number>;
}

/** What came in and went out of each cash, bank and wallet account over a period, by kind, with the balance at each end. */
export async function getCashBook(ctx: TenantContext, from: string, to: string): Promise<CashBook> {
  needView(ctx);
  if (!isValidDate(from) || !isValidDate(to) || from > to) throw new DomainError("Choose valid dates.");
  await syncPostings(ctx.businessId);
  const accounts = await db.account.findMany({ where: { businessId: ctx.businessId, moneyAccount: true }, orderBy: { code: "asc" }, select: { id: true, name: true, type: true } });
  const ids = accounts.map((a) => a.id);
  const [before, lines] = await Promise.all([
    db.journalLine.groupBy({ by: ["accountId"], where: { businessId: ctx.businessId, accountId: { in: ids }, entry: { businessId: ctx.businessId, date: { lt: from } } }, _sum: { debit: true, credit: true } }),
    db.journalLine.findMany({
      where: { businessId: ctx.businessId, accountId: { in: ids }, entry: { businessId: ctx.businessId, date: { gte: from, lte: to } } },
      select: { accountId: true, debit: true, credit: true, entry: { select: { voucher: true, entryKind: true } } },
    }),
  ]);
  const opening: Record<string, number> = {};
  for (const a of accounts) {
    const s = before.find((b) => b.accountId === a.id)?._sum;
    opening[a.id] = signed(a.type, s?.debit ?? 0, s?.credit ?? 0);
  }
  const rec = new Map<string, Record<string, number>>(RECEIPT_ROWS.map((r) => [r, {}]));
  const pay = new Map<string, Record<string, number>>(PAYMENT_ROWS.map((r) => [r, {}]));
  for (const l of lines) {
    const type = classify(l.entry);
    if (l.debit > 0) {
      const row = rec.get(cashBookRow(type, "IN"))!;
      row[l.accountId] = (row[l.accountId] ?? 0) + l.debit;
    }
    if (l.credit > 0) {
      const row = pay.get(cashBookRow(type, "OUT"))!;
      row[l.accountId] = (row[l.accountId] ?? 0) + l.credit;
    }
  }
  const build = (m: Map<string, Record<string, number>>) =>
    [...m.entries()].map(([row, byAccount]) => ({ row, byAccount, total: Object.values(byAccount).reduce((n, v) => n + v, 0) })).filter((r) => r.total > 0);
  const receipts = build(rec);
  const payments = build(pay);
  const sum = (rows: { byAccount: Record<string, number> }[]) => {
    const t: Record<string, number> = {};
    for (const a of accounts) t[a.id] = rows.reduce((n, r) => n + (r.byAccount[a.id] ?? 0), 0);
    return { byAccount: t, all: Object.values(t).reduce((n, v) => n + v, 0) };
  };
  const receiptsTotal = sum(receipts);
  const paymentsTotal = sum(payments);
  const closing: Record<string, number> = {};
  for (const a of accounts) closing[a.id] = opening[a.id]! + receiptsTotal.byAccount[a.id]! - paymentsTotal.byAccount[a.id]!;
  return { accounts: accounts.map((a) => ({ id: a.id, name: a.name })), opening, receipts, payments, receiptsTotal, paymentsTotal, closing };
}
