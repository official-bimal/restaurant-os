import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { addDays, isValidDate, localDate } from "@/lib/business-day";
import { DEFAULT_CHART, ACCOUNT_TYPES, type AccountType } from "../chart";
import { fiscalYearOf, fiscalYearRange } from "../fiscal";
import { refundLines, saleLines, supplierBillLines, supplierPaymentLines, payrollLines, salaryPaidLines, balanced, type Line } from "../postings";
import { balanceSheet, ledger, profitAndLoss, trialBalance, type AccountInfo, type PostedLine } from "../books";

/**
 * The accounting books: chart of accounts, the journal (vouchers) and the reports worked out from it. Every query is filtered by
 * businessId. A voucher is never edited or deleted: a mistake is put right by a reversing entry, so the books can always be explained.
 *
 * Sales, refunds, supplier bills and supplier payments are posted to the journal by `syncPostings`, which runs before any report is
 * read (and from the background timer). Each event is posted exactly once: the journal's (sourceKind, sourceId) is unique.
 */

const MAX_PAISA = 100_000_000_000;
const MANUAL_VOUCHERS = ["JOURNAL", "PAYMENT", "RECEIPT", "CONTRA", "OPENING"] as const;
export type ManualVoucher = (typeof MANUAL_VOUCHERS)[number];

function needView(ctx: TenantContext) {
  if (!can(ctx.role, "books.view")) throw new DomainError("You do not have permission to see the accounts.");
}
function needManage(ctx: TenantContext) {
  if (!can(ctx.role, "books.manage")) throw new DomainError("Only the owner can change the accounts.");
}

function cleanText(value: string | undefined | null, max: number, what: string): string {
  const t = (value ?? "").trim().replace(/\s+/g, " ");
  if (!t) throw new DomainError(`${what} is required.`);
  if (t.length > max) throw new DomainError(`${what} is too long (${max} characters at most).`);
  return t;
}

// ---------------------------------------------------------------------------------------------------
// the chart of accounts

/** Creates the standard chart for a business that has none yet. Safe to call again. */
const chartChecked = new Set<string>();

export async function ensureChart(businessId: string): Promise<void> {
  if (chartChecked.has(businessId)) return;
  if ((await db.account.count({ where: { businessId } })) === 0) {
    await db.account.createMany({
      data: DEFAULT_CHART.map((a) => ({ businessId, code: a.code, name: a.name, type: a.type, key: a.key ?? null })),
      skipDuplicates: true,
    });
  } else {
    // A chart made before a system account existed: give the account its key, or add it.
    const have = await db.account.findMany({ where: { businessId }, select: { code: true, key: true } });
    const keys = new Set(have.map((a) => a.key).filter(Boolean));
    for (const a of DEFAULT_CHART) {
      if (!a.key || keys.has(a.key)) continue;
      const sameCode = have.find((h) => h.code === a.code);
      if (sameCode) await db.account.updateMany({ where: { businessId, code: a.code, key: null }, data: { key: a.key } });
      else await db.account.createMany({ data: [{ businessId, code: a.code, name: a.name, type: a.type, key: a.key }], skipDuplicates: true });
    }
  }
  chartChecked.add(businessId);
}

export async function listAccounts(ctx: TenantContext) {
  needView(ctx);
  await ensureChart(ctx.businessId);
  return db.account.findMany({ where: { businessId: ctx.businessId }, orderBy: { code: "asc" } });
}

export async function createAccount(ctx: TenantContext, input: { code: string; name: string; type: string }) {
  needManage(ctx);
  const code = cleanText(input.code, 12, "The code");
  const name = cleanText(input.name, 80, "The name");
  if (!/^[0-9A-Za-z.-]+$/.test(code)) throw new DomainError("The code may use letters, numbers, dots and dashes only.");
  if (!ACCOUNT_TYPES.includes(input.type as AccountType)) throw new DomainError("Choose the kind of account.");
  await ensureChart(ctx.businessId);
  return db.$transaction(async (tx) => {
    if (await tx.account.findFirst({ where: { businessId: ctx.businessId, code } })) throw new DomainError("That code is already used.");
    const a = await tx.account.create({ data: { businessId: ctx.businessId, code, name, type: input.type as AccountType } });
    await audit(tx, ctx, "account.create", "Account", a.id, { code, name });
    return a;
  });
}

/** Rename an account or switch it off. System accounts (the ones the software posts to) cannot be switched off. */
export async function updateAccount(ctx: TenantContext, id: string, input: { name?: string; active?: boolean }) {
  needManage(ctx);
  return db.$transaction(async (tx) => {
    const a = await tx.account.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!a) throw new DomainError("Account not found.");
    const data: { name?: string; active?: boolean } = {};
    if (input.name !== undefined) data.name = cleanText(input.name, 80, "The name");
    if (input.active !== undefined) {
      if (!input.active && a.key) throw new DomainError("The software posts to this account, so it cannot be switched off.");
      data.active = input.active;
    }
    const out = await tx.account.update({ where: { id: a.id }, data });
    await audit(tx, ctx, "account.update", "Account", a.id, data);
    return out;
  });
}

// ---------------------------------------------------------------------------------------------------
// posting

type Keyed = Map<string, string>; // system key -> account id

export async function keyMap(tx: Tx, businessId: string): Promise<Keyed> {
  const rows = await tx.account.findMany({ where: { businessId, key: { not: null } }, select: { id: true, key: true } });
  return new Map(rows.map((r) => [r.key!, r.id]));
}

export interface NewEntry {
  businessId: string;
  branchId?: string | null;
  date: string;
  voucher: string;
  narration: string;
  sourceKind?: string;
  sourceId?: string;
  reversesId?: string;
  createdById?: string | null;
  lines: { accountId: string; debit: number; credit: number; narration?: string | null }[];
}

/** Writes one balanced voucher with the next number of its fiscal year. */
export async function writeEntry(tx: Tx, e: NewEntry) {
  if (!balanced(e.lines)) throw new DomainError("Debits and credits must be equal.");
  // Something the software posts by itself (a sale, a bill) never lands in a fiscal year that has been closed: it goes on the first open day.
  const closed = e.sourceKind ? await latestClosedDate(tx, e.businessId) : null;
  if (closed && e.date <= closed) e = { ...e, date: addDays(closed, 1) };
  const fiscalYear = fiscalYearOf(e.date);
  // One writer at a time per business, so numbers have no gaps and no two vouchers get the same one.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"journal:" + e.businessId}))`;
  const last = await tx.journalEntry.aggregate({ where: { businessId: e.businessId, fiscalYear }, _max: { number: true } });
  const entry = await tx.journalEntry.create({
    data: {
      businessId: e.businessId,
      branchId: e.branchId ?? null,
      fiscalYear,
      number: (last._max.number ?? 0) + 1,
      date: e.date,
      voucher: e.voucher,
      narration: e.narration,
      sourceKind: e.sourceKind ?? null,
      sourceId: e.sourceId ?? null,
      reversesId: e.reversesId ?? null,
      createdById: e.createdById ?? null,
    },
  });
  // The lines are made on their own: nested creates cannot fill in the business half of the composite keys.
  await tx.journalLine.createMany({
    data: e.lines.map((l) => ({ businessId: e.businessId, entryId: entry.id, accountId: l.accountId, debit: l.debit, credit: l.credit, narration: l.narration ?? null })),
  });
  return entry;
}

export function resolve(keys: Keyed, lines: Line[]) {
  return lines.map((l) => {
    const accountId = keys.get(l.key);
    if (!accountId) throw new DomainError(`The account "${l.key}" is missing from the chart.`);
    return { accountId, debit: l.debit, credit: l.credit, narration: l.narration };
  });
}

const BATCH = 200;

/**
 * Posts every sale, refund, supplier bill and supplier payment that is not in the journal yet. Returns how many were posted.
 * Safe to run at any time and from several places at once: each event is posted once.
 */
export async function syncPostings(businessId: string): Promise<number> {
  await ensureChart(businessId);
  const biz = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  let posted = 0;

  const unposted = async (table: string, kind: string, order: string, extra = ""): Promise<string[]> => {
    // table and order are fixed strings from this file, never user input.
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT t."id" FROM "${table}" t WHERE t."businessId" = $1 AND NOT EXISTS (SELECT 1 FROM "JournalEntry" j WHERE j."businessId" = t."businessId" AND j."sourceKind" = $2 AND j."sourceId" = t."id") ${extra} ORDER BY t."${order}" LIMIT ${BATCH}`,
      businessId,
      kind,
    );
    return rows.map((r) => r.id);
  };

  for (let round = 0; round < 50; round++) {
    let did = 0;

    for (const id of await unposted("Invoice", "SALE", "createdAt")) {
      did += await db.$transaction(async (tx) => {
        const inv = await tx.invoice.findFirst({ where: { id, businessId }, include: { payments: true } });
        if (!inv) return 0;
        const keys = await keyMap(tx, businessId);
        await writeEntry(tx, {
          businessId,
          branchId: inv.branchId,
          date: localDate(inv.createdAt, biz.timezone),
          voucher: "SALE",
          narration: `Sale, bill ${inv.number}`,
          sourceKind: "SALE",
          sourceId: inv.id,
          lines: resolve(keys, saleLines({ ...inv, payments: inv.payments.map((p) => ({ method: p.method, amount: p.amount })) })),
        });
        return 1;
      }).catch(ignoreDuplicate);
    }

    for (const id of await unposted("CreditNote", "REFUND", "createdAt")) {
      did += await db.$transaction(async (tx) => {
        const cn = await tx.creditNote.findFirst({ where: { id, businessId }, include: { refunds: true, invoice: { select: { branchId: true } } } });
        if (!cn) return 0;
        const keys = await keyMap(tx, businessId);
        await writeEntry(tx, {
          businessId,
          branchId: cn.invoice.branchId,
          date: localDate(cn.createdAt, biz.timezone),
          voucher: "REFUND",
          narration: `Refund, credit note ${cn.number}: ${cn.reason}`.slice(0, 200),
          sourceKind: "REFUND",
          sourceId: cn.id,
          lines: resolve(keys, refundLines({ ...cn, refunds: cn.refunds.map((r) => ({ method: r.method, amount: r.amount })) })),
        });
        return 1;
      }).catch(ignoreDuplicate);
    }

    for (const id of await unposted("SupplierBill", "PURCHASE", "createdAt")) {
      did += await db.$transaction(async (tx) => {
        const b = await tx.supplierBill.findFirst({ where: { id, businessId }, include: { supplier: { select: { name: true } } } });
        if (!b) return 0;
        // A bill voided before it was ever posted never reaches the books.
        if (b.voidedAt) return 0;
        const keys = await keyMap(tx, businessId);
        await writeEntry(tx, {
          businessId,
          branchId: b.branchId,
          date: b.billDate,
          voucher: "PURCHASE",
          narration: `Purchase from ${b.supplier.name}${b.number ? `, bill ${b.number}` : ""}`,
          sourceKind: "PURCHASE",
          sourceId: b.id,
          lines: resolve(keys, supplierBillLines(b.amount, b.vatAmount, b.tdsAmount)),
        });
        return 1;
      }).catch(ignoreDuplicate);
    }

    for (const id of await unposted("SupplierPayment", "SUPPLIER_PAYMENT", "createdAt")) {
      did += await db.$transaction(async (tx) => {
        const p = await tx.supplierPayment.findFirst({ where: { id, businessId }, include: { bill: { include: { supplier: { select: { name: true } } } } } });
        if (!p) return 0;
        const keys = await keyMap(tx, businessId);
        await writeEntry(tx, {
          businessId,
          branchId: p.bill.branchId,
          date: p.paidOn,
          voucher: "SUPPLIER_PAYMENT",
          narration: `Paid ${p.bill.supplier.name}${p.reference ? `, ref ${p.reference}` : ""}`,
          sourceKind: "SUPPLIER_PAYMENT",
          sourceId: p.id,
          lines: resolve(keys, supplierPaymentLines(p.amount, p.method)),
        });
        return 1;
      }).catch(ignoreDuplicate);
    }

    for (const id of await unposted("PayrollRun", "PAYROLL", "createdAt")) {
      did += await db.$transaction(async (tx) => {
        const run = await tx.payrollRun.findFirst({ where: { id, businessId }, include: { lines: true } });
        if (!run) return 0;
        const total = run.lines.reduce((n, l) => n + l.netPay, 0);
        if (total <= 0) return 0;
        const keys = await keyMap(tx, businessId);
        await writeEntry(tx, {
          businessId,
          date: run.periodEnd,
          voucher: "PAYROLL",
          narration: `Wages for ${run.periodStart} to ${run.periodEnd}`,
          sourceKind: "PAYROLL",
          sourceId: run.id,
          lines: resolve(keys, payrollLines(total)),
        });
        return 1;
      }).catch(ignoreDuplicate);
    }

    for (const id of await unposted("PayrollLine", "SALARY_PAID", "id", `AND t."paidAt" IS NOT NULL AND t."netPay" > 0 AND EXISTS (SELECT 1 FROM "JournalEntry" w WHERE w."businessId" = t."businessId" AND w."sourceKind" = 'PAYROLL' AND w."sourceId" = t."runId")`)) {
      did += await db.$transaction(async (tx) => {
        const l = await tx.payrollLine.findFirst({ where: { id, businessId } });
        if (!l || !l.paidAt) return 0;
        const keys = await keyMap(tx, businessId);
        await writeEntry(tx, {
          businessId,
          date: localDate(l.paidAt, biz.timezone),
          voucher: "SALARY_PAID",
          narration: `Salary paid to ${l.name}`,
          sourceKind: "SALARY_PAID",
          sourceId: l.id,
          lines: resolve(keys, salaryPaidLines(l.netPay, l.paidMethod ?? "")),
        });
        return 1;
      }).catch(ignoreDuplicate);
    }

    // A supplier bill voided after it was posted is taken back out by a reversing entry.
    const voided = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT j."id" FROM "JournalEntry" j JOIN "SupplierBill" b ON b."businessId" = j."businessId" AND b."id" = j."sourceId" WHERE j."businessId" = $1 AND j."sourceKind" = 'PURCHASE' AND b."voidedAt" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "JournalEntry" r WHERE r."businessId" = j."businessId" AND r."reversesId" = j."id") LIMIT ${BATCH}`,
      businessId,
    );
    for (const { id } of voided) {
      did += await db.$transaction((tx) => reverseInTx(tx, businessId, id, "Supplier bill voided", null)).then(() => 1).catch(ignoreDuplicate);
    }

    posted += did;
    if (did === 0) break;
  }
  return posted;
}

function ignoreDuplicate(e: unknown): number {
  // Another run posted the same event a moment ago: that is fine, it is in the books exactly once.
  if (typeof e === "object" && e && (e as { code?: string }).code === "P2002") return 0;
  throw e;
}

/** The last day of the latest fiscal year that has been closed (and not reopened), or null. */
export async function latestClosedDate(tx: Tx, businessId: string): Promise<string | null> {
  const rows = await tx.journalEntry.findMany({ where: { businessId, voucher: "CLOSING", reversesId: null }, select: { id: true, date: true }, orderBy: { date: "desc" } });
  for (const r of rows) {
    if (!(await tx.journalEntry.findFirst({ where: { businessId, reversesId: r.id }, select: { id: true } }))) return r.date;
  }
  return null;
}

export async function reverseInTx(tx: Tx, businessId: string, entryId: string, reason: string, userId: string | null, opts: { date?: string; voucher?: string } = {}) {
  const orig = await tx.journalEntry.findFirst({ where: { id: entryId, businessId }, include: { lines: true } });
  if (!orig) throw new DomainError("Voucher not found.");
  if (orig.voucher === "REVERSAL" || (orig.voucher === "CLOSING" && orig.reversesId)) throw new DomainError("A reversal cannot be reversed. Make a new voucher instead.");
  if (await tx.journalEntry.findFirst({ where: { businessId, reversesId: orig.id } })) throw new DomainError("That voucher has already been reversed.");
  const biz = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  // The reversal is dated today, never back in a period that may already have been filed.
  const date = opts.date ?? localDate(new Date(), biz.timezone);
  return writeEntry(tx, {
    businessId,
    branchId: orig.branchId,
    date,
    voucher: opts.voucher ?? "REVERSAL",
    narration: `Reversal of ${orig.fiscalYear} #${orig.number}: ${reason}`.slice(0, 200),
    reversesId: orig.id,
    createdById: userId,
    lines: orig.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, narration: l.narration })),
  });
}

// ---------------------------------------------------------------------------------------------------
// vouchers typed by a person

export interface VoucherLineInput {
  accountId: string;
  debit: number;
  credit: number;
  narration?: string;
}

export async function createVoucher(ctx: TenantContext, input: { voucher: string; date: string; narration: string; lines: VoucherLineInput[] }) {
  needManage(ctx);
  if (!MANUAL_VOUCHERS.includes(input.voucher as ManualVoucher)) throw new DomainError("Choose the kind of voucher.");
  if (!isValidDate(input.date)) throw new DomainError("Choose a valid date.");
  const narration = cleanText(input.narration, 200, "The description");
  if (input.lines.length < 2) throw new DomainError("A voucher needs at least two lines.");
  if (input.lines.length > 40) throw new DomainError("That is too many lines for one voucher.");
  for (const l of input.lines) {
    for (const v of [l.debit, l.credit]) {
      if (!Number.isInteger(v) || v < 0 || v > MAX_PAISA) throw new DomainError("Amounts must be whole numbers of paisa, zero or more.");
    }
    if ((l.debit > 0) === (l.credit > 0)) throw new DomainError("Each line is either a debit or a credit, not both and not neither.");
  }
  if (!balanced(input.lines)) throw new DomainError("Total debits must equal total credits.");

  const biz = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  if (input.date > localDate(new Date(), biz.timezone)) throw new DomainError("A voucher cannot be dated in the future.");

  return db.$transaction(async (tx) => {
    const closed = await latestClosedDate(tx, ctx.businessId);
    if (closed && input.date <= closed) throw new DomainError(`The fiscal year up to ${closed} is closed. Date the voucher after that, or ask the owner to reopen the year.`);
    const ids = [...new Set(input.lines.map((l) => l.accountId))];
    const accounts = await tx.account.findMany({ where: { businessId: ctx.businessId, id: { in: ids } } });
    if (accounts.length !== ids.length) throw new DomainError("One of the accounts was not found.");
    if (accounts.some((a) => !a.active)) throw new DomainError("One of the accounts is switched off.");
    const e = await writeEntry(tx, {
      businessId: ctx.businessId,
      branchId: ctx.branchId ?? null,
      date: input.date,
      voucher: input.voucher,
      narration,
      createdById: ctx.userId,
      lines: input.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, narration: l.narration?.trim().slice(0, 120) || null })),
    });
    await audit(tx, ctx, "voucher.create", "JournalEntry", e.id, { voucher: e.voucher, number: e.number, fiscalYear: e.fiscalYear });
    return e;
  });
}

/** Puts a mistake right: posts the opposite of a voucher a person typed. */
export async function reverseVoucher(ctx: TenantContext, entryId: string, reason: string) {
  needManage(ctx);
  const why = cleanText(reason, 120, "The reason");
  return db.$transaction(async (tx) => {
    const orig = await tx.journalEntry.findFirst({ where: { id: entryId, businessId: ctx.businessId } });
    if (!orig) throw new DomainError("Voucher not found.");
    if (!MANUAL_VOUCHERS.includes(orig.voucher as ManualVoucher)) {
      throw new DomainError("This entry comes from a bill, refund or supplier payment. Correct it there (refund the bill or void the supplier bill) and the books follow.");
    }
    const r = await reverseInTx(tx, ctx.businessId, entryId, why, ctx.userId);
    await audit(tx, ctx, "voucher.reverse", "JournalEntry", r.id, { reverses: orig.id, reason: why });
    return r;
  });
}

// ---------------------------------------------------------------------------------------------------
// reading the books

function range(from: string, to: string) {
  if (!isValidDate(from) || !isValidDate(to)) throw new DomainError("Choose valid dates.");
  if (from > to) throw new DomainError("The start date is after the end date.");
}

async function lineRows(businessId: string, where: { from?: string; to?: string; accountId?: string; excludeClosing?: boolean }) {
  const rows = await db.journalLine.findMany({
    where: {
      businessId,
      ...(where.accountId ? { accountId: where.accountId } : {}),
      entry: { businessId, ...(where.excludeClosing ? { voucher: { not: "CLOSING" } } : {}), ...(where.from || where.to ? { date: { ...(where.from ? { gte: where.from } : {}), ...(where.to ? { lte: where.to } : {}) } } : {}) },
    },
    select: { accountId: true, debit: true, credit: true, entry: { select: { date: true } } },
  });
  return rows.map<PostedLine>((r) => ({ accountId: r.accountId, date: r.entry.date, debit: r.debit, credit: r.credit }));
}

async function infoOf(businessId: string): Promise<AccountInfo[]> {
  const a = await db.account.findMany({ where: { businessId }, select: { id: true, code: true, name: true, type: true } });
  return a;
}

async function prepare(ctx: TenantContext) {
  needView(ctx);
  await syncPostings(ctx.businessId);
}

export async function getTrialBalance(ctx: TenantContext, asOf: string) {
  await prepare(ctx);
  if (!isValidDate(asOf)) throw new DomainError("Choose a valid date.");
  const [accounts, lines] = await Promise.all([infoOf(ctx.businessId), lineRows(ctx.businessId, { to: asOf })]);
  return trialBalance(accounts, lines);
}

export async function getProfitAndLoss(ctx: TenantContext, from: string, to: string) {
  await prepare(ctx);
  range(from, to);
  const [accounts, lines] = await Promise.all([infoOf(ctx.businessId), lineRows(ctx.businessId, { from, to, excludeClosing: true })]);
  return profitAndLoss(accounts, lines);
}

export async function getBalanceSheet(ctx: TenantContext, asOf: string) {
  await prepare(ctx);
  if (!isValidDate(asOf)) throw new DomainError("Choose a valid date.");
  const [accounts, lines] = await Promise.all([infoOf(ctx.businessId), lineRows(ctx.businessId, { to: asOf })]);
  return balanceSheet(accounts, lines);
}

/** One account's ledger for a period, with the balance brought forward. */
export async function getLedger(ctx: TenantContext, accountId: string, from: string, to: string) {
  await prepare(ctx);
  range(from, to);
  const account = await db.account.findFirst({ where: { id: accountId, businessId: ctx.businessId } });
  if (!account) throw new DomainError("Account not found.");
  const before = await db.journalLine.aggregate({
    where: { businessId: ctx.businessId, accountId, entry: { businessId: ctx.businessId, date: { lt: from } } },
    _sum: { debit: true, credit: true },
  });
  const lines = await db.journalLine.findMany({
    where: { businessId: ctx.businessId, accountId, entry: { businessId: ctx.businessId, date: { gte: from, lte: to } } },
    include: { entry: true },
    orderBy: [{ entry: { date: "asc" } }, { entry: { fiscalYear: "asc" } }, { entry: { number: "asc" } }],
    take: 5000,
  });
  const book = ledger(
    account.type,
    { debit: before._sum.debit ?? 0, credit: before._sum.credit ?? 0 },
    lines.map((l) => ({ entryId: l.entryId, date: l.entry.date, number: `${l.entry.fiscalYear} #${l.entry.number}`, narration: l.narration || l.entry.narration, debit: l.debit, credit: l.credit })),
  );
  return { account, ...book };
}

/** The daybook: every voucher of a period in the order it was made, with its lines. */
export async function getDaybook(ctx: TenantContext, from: string, to: string) {
  await prepare(ctx);
  range(from, to);
  const entries = await db.journalEntry.findMany({
    where: { businessId: ctx.businessId, date: { gte: from, lte: to } },
    include: { lines: { include: { account: { select: { code: true, name: true } } }, orderBy: [{ debit: "desc" }, { id: "asc" }] } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    take: 2000,
  });
  const reversed = new Set(entries.map((e) => e.reversesId).filter(Boolean) as string[]);
  return {
    entries: entries.map((e) => ({ ...e, reversed: reversed.has(e.id), isManual: (MANUAL_VOUCHERS as readonly string[]).includes(e.voucher) })),
    totalDebit: entries.reduce((n, e) => n + e.lines.reduce((m, l) => m + l.debit, 0), 0),
  };
}

/** The current fiscal year and its dates, for default report periods. */
export async function currentPeriod(ctx: TenantContext) {
  const biz = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const today = localDate(new Date(), biz.timezone);
  const fiscalYear = fiscalYearOf(today);
  return { today, fiscalYear, ...fiscalYearRange(fiscalYear) };
}
