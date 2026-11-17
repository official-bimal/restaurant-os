import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { dayRange } from "@/lib/business-day";
import { computePay, isPeriod, monthBounds, netPay, splitMinutes, sumAdjustments, type AdjustKind } from "@/features/payroll/payroll";

/**
 * Pay terms, adjustments and monthly payroll. Owners only. A payroll run is a copy of what was worked out at the time and
 * is never recalculated; once a month is finalized its hours and adjustments are locked. Pay is shown before any tax or
 * statutory deductions, which this app does not calculate. Every query is filtered by businessId.
 */

const MAX_PAISA = 100_000_000_00;
const KINDS: readonly AdjustKind[] = ["ALLOWANCE", "BONUS", "ADVANCE", "DEDUCTION"];

function need(ctx: TenantContext) {
  if (!can(ctx.role, "payroll.manage")) throw new DomainError("Only the owner can handle payroll.");
}

async function bounds(businessId: string, period: string) {
  if (!isPeriod(period)) throw new DomainError("Choose a month.");
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const { start, end } = monthBounds(period);
  return { timezone, start, end, from: dayRange(start, timezone).start, to: dayRange(end, timezone).end };
}

async function isFinalized(client: Pick<typeof db, "payrollRun">, businessId: string, period: string) {
  const { start, end } = monthBounds(period);
  return !!(await client.payrollRun.findFirst({ where: { businessId, periodStart: start, periodEnd: end }, select: { id: true } }));
}

export async function setPayTerms(
  ctx: TenantContext,
  userId: string,
  input: { payType: string; payRate: number; overtimeBps?: number; overtimeAfterMinutes?: number },
) {
  need(ctx);
  if (!["NONE", "HOURLY", "MONTHLY"].includes(input.payType)) throw new DomainError("Choose how this person is paid.");
  if (!Number.isInteger(input.payRate) || input.payRate < 0 || input.payRate > MAX_PAISA) throw new DomainError("Enter a pay amount of Rs 0 or more.");
  const overtimeBps = input.overtimeBps ?? 15_000;
  const overtimeAfterMinutes = input.overtimeAfterMinutes ?? 480;
  if (!Number.isInteger(overtimeBps) || overtimeBps < 10_000 || overtimeBps > 40_000) throw new DomainError("Overtime must be between 1 and 4 times the normal rate.");
  if (!Number.isInteger(overtimeAfterMinutes) || overtimeAfterMinutes < 60 || overtimeAfterMinutes > 960) throw new DomainError("Overtime starts after 1 to 16 hours in a day.");
  await db.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({ where: { businessId: ctx.businessId, userId }, include: { user: { select: { name: true } } } });
    if (!m) throw new DomainError("Staff member not found.");
    await tx.membership.update({
      where: { id: m.id },
      data: { payType: input.payType as "NONE" | "HOURLY" | "MONTHLY", payRate: input.payRate, overtimeBps, overtimeAfterMinutes },
    });
    await audit(tx, ctx, "payroll.terms", "Membership", m.id, { who: m.user.name, payType: input.payType, payRate: input.payRate });
  });
}

export async function addAdjustment(ctx: TenantContext, input: { userId: string; period: string; kind: string; amount: number; note?: string }) {
  need(ctx);
  if (!isPeriod(input.period)) throw new DomainError("Choose a month.");
  if (!(KINDS as readonly string[]).includes(input.kind)) throw new DomainError("Choose what kind of adjustment this is.");
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_PAISA) throw new DomainError("Enter an amount above zero.");
  const note = input.note?.trim().replace(/\s+/g, " ").slice(0, 200) || null;
  await db.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({ where: { businessId: ctx.businessId, userId: input.userId } });
    if (!m) throw new DomainError("Staff member not found.");
    if (await isFinalized(tx, ctx.businessId, input.period)) throw new DomainError("Payroll for that month is finalized.");
    const a = await tx.payAdjustment.create({
      data: { businessId: ctx.businessId, userId: input.userId, period: input.period, kind: input.kind as AdjustKind, amount: input.amount, note, createdById: ctx.userId },
    });
    await audit(tx, ctx, "payroll.adjust", "PayAdjustment", a.id, { kind: input.kind, amount: input.amount, period: input.period });
  });
}

export async function removeAdjustment(ctx: TenantContext, id: string) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const a = await tx.payAdjustment.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!a) throw new DomainError("Adjustment not found.");
    if (await isFinalized(tx, ctx.businessId, a.period)) throw new DomainError("Payroll for that month is finalized.");
    await tx.payAdjustment.delete({ where: { id } });
    await audit(tx, ctx, "payroll.unadjust", "PayAdjustment", id, { kind: a.kind, amount: a.amount, period: a.period });
  });
}

/** What payroll for a month works out to right now (nothing is saved). Staff with no pay terms are left out. */
export async function previewPayroll(ctx: TenantContext, period: string) {
  need(ctx);
  const { businessId } = ctx;
  const b = await bounds(businessId, period);
  const [members, entries, adjustments, finalized] = await Promise.all([
    db.membership.findMany({ where: { businessId, payType: { not: "NONE" } }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    db.timeEntry.findMany({ where: { businessId, clockIn: { gte: b.from, lt: b.to } } }),
    db.payAdjustment.findMany({ where: { businessId, period }, orderBy: { createdAt: "asc" } }),
    isFinalized(db, businessId, period),
  ]);
  const open = entries.filter((e) => !e.clockOut);
  const lines = members.map((m) => {
    const mine = entries.filter((e) => e.userId === m.userId && e.clockOut);
    const minutes = splitMinutes(mine.map((e) => ({ clockIn: e.clockIn, clockOut: e.clockOut! })), b.timezone, m.overtimeAfterMinutes);
    const pay = computePay({ payType: m.payType, rate: m.payRate, overtimeBps: m.overtimeBps }, minutes);
    const adj = adjustments.filter((a) => a.userId === m.userId);
    const sums = sumAdjustments(adj);
    return {
      userId: m.userId,
      name: m.user.name,
      payType: m.payType,
      rate: m.payRate,
      regularMinutes: minutes.regular,
      overtimeMinutes: minutes.overtime,
      ...pay,
      ...sums,
      netPay: netPay(pay, sums),
      adjustments: adj,
      stillClockedIn: open.some((e) => e.userId === m.userId),
    };
  });
  return { period, start: b.start, end: b.end, lines, total: lines.reduce((n, l) => n + l.netPay, 0), finalized, openEntries: open.length };
}

/**
 * Finish a month's payroll: a copy of the preview is saved and the month is locked. Refused while anyone is still clocked
 * in during the month, so nobody's hours are cut short.
 */
export async function finalizePayroll(ctx: TenantContext, period: string, note?: string) {
  need(ctx);
  const { businessId } = ctx;
  const preview = await previewPayroll(ctx, period);
  if (preview.finalized) throw new DomainError("Payroll for that month is already finalized.");
  if (preview.lines.length === 0) throw new DomainError("Nobody has pay terms set, so there is nothing to finalize.");
  if (preview.openEntries > 0) throw new DomainError("Someone is still clocked in. Clock them out (or correct their time) first.");
  const clean = note?.trim().replace(/\s+/g, " ").slice(0, 200) || null;
  return db.$transaction(async (tx) => {
    if (await isFinalized(tx, businessId, period)) throw new DomainError("Payroll for that month is already finalized.");
    const run = await tx.payrollRun.create({ data: { businessId, periodStart: preview.start, periodEnd: preview.end, note: clean, finalizedById: ctx.userId } });
    await tx.payrollLine.createMany({
      data: preview.lines.map((l) => ({
        businessId,
        runId: run.id,
        userId: l.userId,
        name: l.name,
        payType: l.payType,
        rate: l.rate,
        regularMinutes: l.regularMinutes,
        overtimeMinutes: l.overtimeMinutes,
        basePay: l.basePay,
        overtimePay: l.overtimePay,
        additions: l.additions,
        deductions: l.deductions,
        netPay: l.netPay,
      })),
    });
    await audit(tx, ctx, "payroll.finalize", "PayrollRun", run.id, { period, people: preview.lines.length, total: preview.total });
    return run;
  });
}

export async function listRuns(ctx: TenantContext) {
  need(ctx);
  return db.payrollRun.findMany({ where: { businessId: ctx.businessId }, include: { lines: { orderBy: { name: "asc" } } }, orderBy: { periodStart: "desc" }, take: 24 });
}

/** Mark a payroll line as paid (once). */
export async function markLinePaid(ctx: TenantContext, lineId: string, method: string) {
  need(ctx);
  const how = method.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!how) throw new DomainError("Say how it was paid.");
  await db.$transaction(async (tx) => {
    const claimed = await tx.payrollLine.updateMany({ where: { id: lineId, businessId: ctx.businessId, paidAt: null }, data: { paidAt: new Date(), paidMethod: how, paidById: ctx.userId } });
    if (claimed.count === 0) {
      const exists = await tx.payrollLine.findFirst({ where: { id: lineId, businessId: ctx.businessId } });
      throw new DomainError(exists ? "That line is already marked as paid." : "Payroll line not found.");
    }
    await audit(tx, ctx, "payroll.paid", "PayrollLine", lineId, { method: how });
  });
}

export async function listAdjustments(ctx: TenantContext, period: string) {
  need(ctx);
  if (!isPeriod(period)) throw new DomainError("Choose a month.");
  return db.payAdjustment.findMany({ where: { businessId: ctx.businessId, period }, orderBy: { createdAt: "asc" } });
}

/** Everyone in the business with their pay terms, for the terms editor. */
export async function listPayTerms(ctx: TenantContext) {
  need(ctx);
  const rows = await db.membership.findMany({
    where: { businessId: ctx.businessId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({ userId: m.user.id, name: m.user.name, role: m.role, payType: m.payType, payRate: m.payRate, overtimeBps: m.overtimeBps, overtimeAfterMinutes: m.overtimeAfterMinutes }));
}
