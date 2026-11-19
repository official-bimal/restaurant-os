import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { isValidDate, localDate } from "@/lib/business-day";
import { fiscalYearRange, toBs, BS_MONTHS } from "../fiscal";
import { yearlyDepreciation } from "../depreciation";
import { signed } from "../books";
import { type Line } from "../postings";
import { getStockValueReport } from "@/features/stock/server/report";
import {
  createVoucher,
  ensureChart,
  keyMap,
  latestClosedDate,
  resolve,
  reverseInTx,
  syncPostings,
  writeEntry,
} from "./service";

/**
 * The rest of the books: opening balances, closing a fiscal year, bank reconciliation, fixed assets with depreciation, budgets and the
 * TDS (tax deducted at source) list. Reading needs `books.view`; changing anything needs `books.manage` (the owner).
 */

function needView(ctx: TenantContext) {
  if (!can(ctx.role, "books.view")) throw new DomainError("You do not have permission to see the accounts.");
}
function needManage(ctx: TenantContext) {
  if (!can(ctx.role, "books.manage")) throw new DomainError("Only the owner can change the accounts.");
}
const FY_RE = /^\d{4}\/\d{2}$/;
function checkFy(fy: string) {
  if (!FY_RE.test(fy)) throw new DomainError("Choose a fiscal year like 2083/84.");
  try {
    return fiscalYearRange(fy);
  } catch {
    throw new DomainError("Choose a fiscal year like 2083/84.");
  }
}
async function todayOf(businessId: string) {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  return localDate(new Date(), b.timezone);
}

// ---------------------------------------------------------------------------------------------------
// opening balances

/** What the business owned and owed when it started using these books. The difference goes to "profit brought forward". */
export async function saveOpeningBalances(ctx: TenantContext, input: { date: string; rows: { accountId: string; debit: number; credit: number }[] }) {
  needManage(ctx);
  const rows = input.rows.filter((r) => r.debit !== 0 || r.credit !== 0);
  if (rows.length === 0) throw new DomainError("Enter at least one opening balance.");
  await ensureChart(ctx.businessId);
  const retained = await db.account.findFirstOrThrow({ where: { businessId: ctx.businessId, key: "RETAINED" } });
  if (rows.some((r) => r.accountId === retained.id)) throw new DomainError("Profit brought forward is worked out for you. Leave it empty.");
  const diff = rows.reduce((n, r) => n + r.debit - r.credit, 0);
  const lines = [...rows];
  if (diff > 0) lines.push({ accountId: retained.id, debit: 0, credit: diff });
  if (diff < 0) lines.push({ accountId: retained.id, debit: -diff, credit: 0 });
  return createVoucher(ctx, { voucher: "OPENING", date: input.date, narration: "Opening balances", lines });
}

// ---------------------------------------------------------------------------------------------------
// closing a fiscal year

/** Fiscal years that have been closed (and not reopened). */
export async function listClosedYears(ctx: TenantContext) {
  needView(ctx);
  const rows = await db.journalEntry.findMany({ where: { businessId: ctx.businessId, voucher: "CLOSING", reversesId: null }, orderBy: { date: "desc" } });
  const out = [];
  for (const r of rows) {
    const reversed = await db.journalEntry.findFirst({ where: { businessId: ctx.businessId, reversesId: r.id }, select: { id: true } });
    if (!reversed) out.push({ id: r.id, fiscalYear: r.fiscalYear, date: r.date });
  }
  return out;
}

/**
 * Closes a fiscal year that has ended: every income and expense account is brought to zero and the profit (or loss) is moved to
 * "profit brought forward". After that nothing can be dated inside the year; the software's own postings (a late bill) go on the first open day.
 */
export async function closeYear(ctx: TenantContext, fy: string) {
  needManage(ctx);
  const { from, to } = checkFy(fy);
  if (to >= (await todayOf(ctx.businessId))) throw new DomainError("A fiscal year can only be closed after it has ended.");
  await syncPostings(ctx.businessId);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"journal:" + ctx.businessId}))`;
    const open = (await listClosedInTx(tx, ctx.businessId)).find((c) => c.fiscalYear === fy);
    if (open) throw new DomainError("That fiscal year is already closed.");
    const later = await latestClosedDate(tx, ctx.businessId);
    if (later && later > to) throw new DomainError("A later fiscal year is already closed. Reopen it first.");
    const keys = await keyMap(tx, ctx.businessId);
    const retainedId = keys.get("RETAINED");
    if (!retainedId) throw new DomainError("The chart of accounts has no profit brought forward account.");
    const accounts = await tx.account.findMany({ where: { businessId: ctx.businessId, type: { in: ["INCOME", "EXPENSE"] } } });
    const sums = await tx.journalLine.groupBy({
      by: ["accountId"],
      where: { businessId: ctx.businessId, accountId: { in: accounts.map((a) => a.id) }, entry: { businessId: ctx.businessId, voucher: { not: "CLOSING" }, date: { gte: from, lte: to } } },
      _sum: { debit: true, credit: true },
    });
    const lines: { accountId: string; debit: number; credit: number }[] = [];
    let profit = 0;
    for (const s of sums) {
      const a = accounts.find((x) => x.id === s.accountId)!;
      const net = signed(a.type, s._sum.debit ?? 0, s._sum.credit ?? 0);
      if (net === 0) continue;
      profit += a.type === "INCOME" ? net : -net;
      // Bring the account to zero: the opposite of what it holds.
      const debitIt = a.type === "INCOME" ? net > 0 : net < 0;
      lines.push({ accountId: a.id, debit: debitIt ? Math.abs(net) : 0, credit: debitIt ? 0 : Math.abs(net) });
    }
    if (lines.length === 0) throw new DomainError("There is nothing to close in that fiscal year.");
    if (profit > 0) lines.push({ accountId: retainedId, debit: 0, credit: profit });
    if (profit < 0) lines.push({ accountId: retainedId, debit: -profit, credit: 0 });
    const e = await writeEntry(tx, { businessId: ctx.businessId, date: to, voucher: "CLOSING", narration: `Closing of fiscal year ${fy}`, createdById: ctx.userId, lines });
    await audit(tx, ctx, "year.close", "JournalEntry", e.id, { fiscalYear: fy, profit });
    return { entry: e, profit };
  });
}

async function listClosedInTx(tx: Parameters<typeof latestClosedDate>[0], businessId: string) {
  const rows = await tx.journalEntry.findMany({ where: { businessId, voucher: "CLOSING", reversesId: null }, orderBy: { date: "desc" } });
  const out = [];
  for (const r of rows) {
    if (!(await tx.journalEntry.findFirst({ where: { businessId, reversesId: r.id }, select: { id: true } }))) out.push({ id: r.id, fiscalYear: r.fiscalYear, date: r.date });
  }
  return out;
}

/** Reopens the most recently closed fiscal year. */
export async function reopenYear(ctx: TenantContext, fy: string) {
  needManage(ctx);
  checkFy(fy);
  return db.$transaction(async (tx) => {
    const closed = await listClosedInTx(tx, ctx.businessId);
    const target = closed.find((c) => c.fiscalYear === fy);
    if (!target) throw new DomainError("That fiscal year is not closed.");
    if (closed[0]!.id !== target.id) throw new DomainError("Reopen the latest closed year first.");
    // Taken back on the day it was made, so the year's own figures are put back as they were.
    const r = await reverseInTx(tx, ctx.businessId, target.id, "year reopened", ctx.userId, { date: target.date, voucher: "CLOSING" });
    await audit(tx, ctx, "year.reopen", "JournalEntry", r.id, { fiscalYear: fy });
    return r;
  });
}

// ---------------------------------------------------------------------------------------------------
// bank reconciliation

/** The lines of one account (usually the bank) still to be matched against the bank statement, and where the matching stands. */
export async function getReconciliation(ctx: TenantContext, accountId: string, upTo: string) {
  needView(ctx);
  if (!isValidDate(upTo)) throw new DomainError("Choose a valid date.");
  await syncPostings(ctx.businessId);
  const account = await db.account.findFirst({ where: { id: accountId, businessId: ctx.businessId } });
  if (!account) throw new DomainError("Account not found.");
  const lines = await db.journalLine.findMany({
    where: { businessId: ctx.businessId, accountId, entry: { businessId: ctx.businessId, date: { lte: upTo } } },
    include: { entry: true },
    orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }],
    take: 5000,
  });
  let book = 0;
  let matched = 0;
  const open = [];
  for (const l of lines) {
    const v = signed(account.type, l.debit, l.credit);
    book += v;
    if (l.reconciledOn) matched += v;
    else open.push({ id: l.id, date: l.entry.date, number: `${l.entry.fiscalYear} #${l.entry.number}`, narration: l.narration || l.entry.narration, debit: l.debit, credit: l.credit });
  }
  return { account, bookBalance: book, matchedBalance: matched, unmatchedBalance: book - matched, open };
}

/** Ticks lines off against a statement. A line can only be ticked once; "unmatch" undoes a mistake. */
export async function markReconciled(ctx: TenantContext, accountId: string, statementDate: string, lineIds: string[]) {
  needManage(ctx);
  if (!isValidDate(statementDate)) throw new DomainError("Choose the statement date.");
  if (lineIds.length === 0) throw new DomainError("Tick at least one line.");
  if (lineIds.length > 2000) throw new DomainError("That is too many lines at once.");
  return db.$transaction(async (tx) => {
    const r = await tx.journalLine.updateMany({ where: { businessId: ctx.businessId, accountId, id: { in: lineIds }, reconciledOn: null }, data: { reconciledOn: statementDate } });
    await audit(tx, ctx, "bank.reconcile", "Account", accountId, { statementDate, lines: r.count });
    return r.count;
  });
}

export async function unmatchLine(ctx: TenantContext, accountId: string, lineId: string) {
  needManage(ctx);
  await db.$transaction(async (tx) => {
    const r = await tx.journalLine.updateMany({ where: { businessId: ctx.businessId, accountId, id: lineId, reconciledOn: { not: null } }, data: { reconciledOn: null } });
    if (r.count === 0) throw new DomainError("That line is not matched.");
    await audit(tx, ctx, "bank.unmatch", "Account", accountId, { lineId });
  });
}

// ---------------------------------------------------------------------------------------------------
// fixed assets

export async function listAssets(ctx: TenantContext) {
  needView(ctx);
  const assets = await db.fixedAsset.findMany({ where: { businessId: ctx.businessId }, include: { depreciations: true }, orderBy: { purchaseDate: "asc" } });
  return assets.map((a) => {
    const accumulated = a.depreciations.reduce((n, d) => n + d.amount, 0);
    return { id: a.id, name: a.name, cost: a.cost, purchaseDate: a.purchaseDate, rateBps: a.rateBps, disposedOn: a.disposedOn, accumulated, bookValue: a.cost - accumulated };
  });
}

export async function addAsset(ctx: TenantContext, input: { name: string; cost: number; purchaseDate: string; rateBps: number; paidFrom: string }) {
  needManage(ctx);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) throw new DomainError("Give the asset a name (80 characters at most).");
  if (!Number.isInteger(input.cost) || input.cost < 1 || input.cost > 100_000_000_000) throw new DomainError("Enter what it cost as a number above zero.");
  if (!Number.isInteger(input.rateBps) || input.rateBps < 1 || input.rateBps > 10_000) throw new DomainError("The yearly rate must be between 0.01% and 100%.");
  if (!isValidDate(input.purchaseDate)) throw new DomainError("Choose the purchase date.");
  if (input.purchaseDate > (await todayOf(ctx.businessId))) throw new DomainError("The purchase date cannot be in the future.");
  const from = { CASH: "CASH", BANK: "BANK", OWED: "PAYABLE" }[input.paidFrom];
  if (!from) throw new DomainError("Say how it was paid for.");
  await ensureChart(ctx.businessId);
  return db.$transaction(async (tx) => {
    const a = await tx.fixedAsset.create({ data: { businessId: ctx.businessId, name, cost: input.cost, purchaseDate: input.purchaseDate, rateBps: input.rateBps } });
    const keys = await keyMap(tx, ctx.businessId);
    const lines: Line[] = [
      { key: "FIXED_ASSETS", debit: input.cost, credit: 0 },
      { key: from, debit: 0, credit: input.cost },
    ];
    await writeEntry(tx, {
      businessId: ctx.businessId,
      date: input.purchaseDate,
      voucher: "ASSET",
      narration: `Bought ${name}`,
      sourceKind: "ASSET",
      sourceId: a.id,
      createdById: ctx.userId,
      lines: resolve(keys, lines),
    });
    await audit(tx, ctx, "asset.add", "FixedAsset", a.id, { name, cost: input.cost });
    return a;
  });
}

/** Marks an asset as sold or scrapped: it stops depreciating from that date. Record any sale money with a voucher. */
export async function disposeAsset(ctx: TenantContext, id: string, date: string) {
  needManage(ctx);
  if (!isValidDate(date)) throw new DomainError("Choose a valid date.");
  await db.$transaction(async (tx) => {
    const a = await tx.fixedAsset.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!a) throw new DomainError("Asset not found.");
    if (a.disposedOn) throw new DomainError("That asset is already marked as sold or scrapped.");
    if (date < a.purchaseDate) throw new DomainError("It cannot be sold before it was bought.");
    await tx.fixedAsset.update({ where: { businessId_id: { businessId: ctx.businessId, id } }, data: { disposedOn: date } });
    await audit(tx, ctx, "asset.dispose", "FixedAsset", id, { date });
  });
}

/** Takes the year's depreciation on every asset that has not had it yet, as one voucher. Safe to run again: an asset is charged once a year. */
export async function runDepreciation(ctx: TenantContext, fy: string) {
  needManage(ctx);
  const range = checkFy(fy);
  const today = await todayOf(ctx.businessId);
  if (range.from > today) throw new DomainError("That fiscal year has not started yet.");
  const date = range.to < today ? range.to : today;
  await ensureChart(ctx.businessId);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"journal:" + ctx.businessId}))`;
    const closed = await latestClosedDate(tx, ctx.businessId);
    if (closed && date <= closed) throw new DomainError("That fiscal year is closed. Reopen it to run depreciation.");
    const assets = await tx.fixedAsset.findMany({ where: { businessId: ctx.businessId, purchaseDate: { lte: range.to } }, include: { depreciations: true } });
    let total = 0;
    let count = 0;
    for (const a of assets) {
      if (a.disposedOn && a.disposedOn < range.from) continue;
      if (a.depreciations.some((d) => d.fiscalYear === fy)) continue;
      const accumulated = a.depreciations.reduce((n, d) => n + d.amount, 0);
      const amount = yearlyDepreciation({ cost: a.cost, accumulated, rateBps: a.rateBps, purchaseDate: a.purchaseDate, disposedOn: a.disposedOn }, range.from, range.to);
      if (amount <= 0) continue;
      await tx.fixedAssetDepreciation.create({ data: { businessId: ctx.businessId, assetId: a.id, fiscalYear: fy, amount } });
      total += amount;
      count++;
    }
    if (total === 0) return { total: 0, count: 0 };
    const keys = await keyMap(tx, ctx.businessId);
    const e = await writeEntry(tx, {
      businessId: ctx.businessId,
      date,
      voucher: "DEPRECIATION",
      narration: `Depreciation for fiscal year ${fy}`,
      createdById: ctx.userId,
      lines: resolve(keys, [
        { key: "DEPRECIATION", debit: total, credit: 0 },
        { key: "ACC_DEPRECIATION", debit: 0, credit: total },
      ]),
    });
    await audit(tx, ctx, "asset.depreciate", "JournalEntry", e.id, { fiscalYear: fy, total, assets: count });
    return { total, count };
  });
}

// ---------------------------------------------------------------------------------------------------
// budgets

export async function saveBudgets(ctx: TenantContext, fy: string, rows: { accountId: string; amount: number }[]) {
  needManage(ctx);
  checkFy(fy);
  for (const r of rows) if (!Number.isInteger(r.amount) || r.amount < 0 || r.amount > 100_000_000_000) throw new DomainError("Budgets must be amounts of zero or more.");
  await db.$transaction(async (tx) => {
    const ids = rows.map((r) => r.accountId);
    const ok = await tx.account.findMany({ where: { businessId: ctx.businessId, id: { in: ids }, type: { in: ["INCOME", "EXPENSE"] } }, select: { id: true } });
    const allowed = new Set(ok.map((a) => a.id));
    for (const r of rows) {
      if (!allowed.has(r.accountId)) throw new DomainError("Budgets are set on income and expense accounts only.");
      if (r.amount === 0) await tx.budget.deleteMany({ where: { businessId: ctx.businessId, fiscalYear: fy, accountId: r.accountId } });
      else
        await tx.budget.upsert({
          where: { businessId_fiscalYear_accountId: { businessId: ctx.businessId, fiscalYear: fy, accountId: r.accountId } },
          create: { businessId: ctx.businessId, fiscalYear: fy, accountId: r.accountId, amount: r.amount },
          update: { amount: r.amount },
        });
    }
    await audit(tx, ctx, "budget.save", "Budget", fy, { accounts: rows.length });
  });
}

/** Budget against what really happened so far, per income and expense account. Variance is positive when things went better than planned. */
export async function getBudgetReport(ctx: TenantContext, fy: string) {
  needView(ctx);
  const { from, to } = checkFy(fy);
  await syncPostings(ctx.businessId);
  const [accounts, budgets, sums] = await Promise.all([
    db.account.findMany({ where: { businessId: ctx.businessId, type: { in: ["INCOME", "EXPENSE"] } }, orderBy: { code: "asc" } }),
    db.budget.findMany({ where: { businessId: ctx.businessId, fiscalYear: fy } }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { businessId: ctx.businessId, entry: { businessId: ctx.businessId, voucher: { not: "CLOSING" }, date: { gte: from, lte: to } } },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const bud = new Map(budgets.map((b) => [b.accountId, b.amount]));
  const act = new Map(sums.map((s) => [s.accountId, s._sum]));
  return accounts.map((a) => {
    const s = act.get(a.id);
    const actual = signed(a.type, s?.debit ?? 0, s?.credit ?? 0);
    const budget = bud.get(a.id) ?? 0;
    return { account: a, budget, actual, variance: a.type === "INCOME" ? actual - budget : budget - actual };
  });
}

// ---------------------------------------------------------------------------------------------------
// TDS

export interface TdsMonth {
  month: string;
  monthName: string;
  /** The date by which it is normally deposited with IRD: the 25th of the following Nepali month. */
  dueBy: string;
  total: number;
  rows: { date: string; bs: string; bill: string; supplier: string; pan: string | null; gross: number; tds: number }[];
}

/** Tax deducted from supplier payments, by Nepali month, with the supplier's PAN, ready to deposit and to report. */
export async function getTdsReport(ctx: TenantContext, from: string, to: string): Promise<{ months: TdsMonth[]; total: number }> {
  needView(ctx);
  if (!isValidDate(from) || !isValidDate(to) || from > to) throw new DomainError("Choose valid dates.");
  const bills = await db.supplierBill.findMany({
    where: { businessId: ctx.businessId, voidedAt: null, tdsAmount: { gt: 0 }, billDate: { gte: from, lte: to } },
    include: { supplier: { select: { name: true, panNumber: true } } },
    orderBy: [{ billDate: "asc" }, { createdAt: "asc" }],
  });
  const by = new Map<string, TdsMonth>();
  for (const b of bills) {
    const bs = toBs(b.billDate);
    const key = `${bs.year}-${String(bs.month).padStart(2, "0")}`;
    let m = by.get(key);
    if (!m) {
      const nextIdx = bs.month % 12;
      const nextYear = bs.month === 12 ? bs.year + 1 : bs.year;
      by.set(key, (m = { month: key, monthName: `${BS_MONTHS[bs.month - 1]} ${bs.year}`, dueBy: `25 ${BS_MONTHS[nextIdx]} ${nextYear}`, total: 0, rows: [] }));
    }
    m.total += b.tdsAmount;
    m.rows.push({ date: b.billDate, bs: `${bs.year}-${String(bs.month).padStart(2, "0")}-${String(bs.day).padStart(2, "0")}`, bill: b.number ?? "(no number)", supplier: b.supplier.name, pan: b.supplier.panNumber, gross: b.amount, tds: b.tdsAmount });
  }
  const months = [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
  return { months, total: months.reduce((n, m) => n + m.total, 0) };
}


// ---------------------------------------------------------------------------------------------------
// stock value

/**
 * Brings the "stock of food and drink" account in line with what the shelves are worth now (from the stock records at average cost), by
 * posting the difference against purchases. Supplier bills are posted as purchases when they arrive, so this is what turns "bought" into
 * "used": do it at the end of each month. Running it twice in a row posts nothing the second time.
 */
export async function postStockValue(ctx: TenantContext) {
  needManage(ctx);
  await syncPostings(ctx.businessId);
  const branchCount = await db.branch.count({ where: { businessId: ctx.businessId, active: true } });
  if (ctx.branchIds.length < branchCount) throw new DomainError("Stock value covers every branch. Ask someone who works in all branches to do this.");
  await ensureChart(ctx.businessId);
  const report = await getStockValueReport(ctx);
  const value = report.totals.value + report.totals.onTheWayValue;
  const today = await todayOf(ctx.businessId);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"journal:" + ctx.businessId}))`;
    const keys = await keyMap(tx, ctx.businessId);
    const inventoryId = keys.get("INVENTORY");
    if (!inventoryId) throw new DomainError("The chart of accounts has no stock account.");
    const sums = await tx.journalLine.aggregate({ where: { businessId: ctx.businessId, accountId: inventoryId }, _sum: { debit: true, credit: true } });
    const booked = (sums._sum.debit ?? 0) - (sums._sum.credit ?? 0);
    const diff = value - booked;
    if (diff === 0) return { posted: 0, value, booked };
    const closed = await latestClosedDate(tx, ctx.businessId);
    if (closed && today <= closed) throw new DomainError("The fiscal year is closed.");
    const lines: Line[] =
      diff > 0
        ? [{ key: "INVENTORY", debit: diff, credit: 0 }, { key: "PURCHASES", debit: 0, credit: diff }]
        : [{ key: "PURCHASES", debit: -diff, credit: 0 }, { key: "INVENTORY", debit: 0, credit: -diff }];
    const e = await writeEntry(tx, {
      businessId: ctx.businessId,
      date: today,
      voucher: "STOCK",
      narration: `Stock counted at ${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}: adjusted from the books`,
      createdById: ctx.userId,
      lines: resolve(keys, lines),
    });
    await audit(tx, ctx, "stock.valuePost", "JournalEntry", e.id, { value, booked, diff });
    return { posted: diff, value, booked };
  });
}
