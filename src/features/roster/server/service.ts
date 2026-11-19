import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { addDays, dayRange, isValidDate } from "@/lib/business-day";
import { clashes, isValidTime, shareOut, shiftMinutes, weekDays, weekStartOf, type Worker } from "../roster";

/**
 * The roster (who works when) and sharing out tips. The roster is for the branch the person works in; managers and the owner change it, and any
 * member of staff can see their own shifts. Tips are recorded by whoever handles the drawer and shared out by the owner, by hours worked (from the
 * time clock) or equally, and added to payroll as a bonus. Every query is filtered by businessId and branch.
 */

function needRoster(ctx: TenantContext) {
  if (!can(ctx.role, "time.manage")) throw new DomainError("You do not have permission to change the roster.");
}

/** People who can be rostered at this branch: staff other than riders and the accountant, who work here. */
async function rosterStaff(businessId: string, branchId: string) {
  const members = await db.membership.findMany({
    where: { businessId, role: { notIn: ["RIDER", "ACCOUNTANT"] }, OR: [{ allBranches: true }, { branches: { some: { branchId } } }] },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({ userId: m.userId, name: m.user.name, role: m.role }));
}

export async function getRosterWeek(ctx: TenantContext, anyDateInWeek: string) {
  needRoster(ctx);
  if (!isValidDate(anyDateInWeek)) throw new DomainError("Choose a valid date.");
  const { businessId, branchId } = scope(ctx);
  const start = weekStartOf(anyDateInWeek);
  const days = weekDays(start);
  const [staff, shifts] = await Promise.all([
    rosterStaff(businessId, branchId),
    db.rosterShift.findMany({ where: { businessId, branchId, date: { gte: days[0]!, lte: days[6]! } }, orderBy: [{ date: "asc" }, { startTime: "asc" }] }),
  ]);
  const hours = new Map<string, number>();
  for (const s of shifts) hours.set(s.userId, (hours.get(s.userId) ?? 0) + shiftMinutes(s.startTime, s.endTime));
  return { start, days, staff, shifts, minutes: Object.fromEntries(hours) };
}

/** A person's own shifts from a date on, whatever their role. */
export async function myShifts(ctx: TenantContext, from: string, days = 14) {
  if (!isValidDate(from)) throw new DomainError("Choose a valid date.");
  const { businessId } = ctx;
  return db.rosterShift.findMany({ where: { businessId, userId: ctx.userId, date: { gte: from, lte: addDays(from, days - 1) } }, orderBy: [{ date: "asc" }, { startTime: "asc" }] });
}

export async function addRosterShift(ctx: TenantContext, input: { userId: string; date: string; startTime: string; endTime: string; note?: string }) {
  needRoster(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!isValidDate(input.date)) throw new DomainError("Choose a valid date.");
  if (!isValidTime(input.startTime) || !isValidTime(input.endTime)) throw new DomainError("Choose a start and an end time.");
  if (shiftMinutes(input.startTime, input.endTime) === 0) throw new DomainError("The start and end time are the same.");
  const note = (input.note ?? "").trim().replace(/\s+/g, " ").slice(0, 80) || null;
  // Checked before the transaction starts: the staff list is read on its own connection.
  if (!(await rosterStaff(businessId, branchId)).some((s) => s.userId === input.userId)) throw new DomainError("That person does not work at this branch.");
  return db.$transaction(async (tx) => {
    const near = await tx.rosterShift.findMany({ where: { businessId, userId: input.userId, date: { in: [addDays(input.date, -1), input.date, addDays(input.date, 1)] } } });
    const hit = near.find((o) => clashes({ date: input.date, start: input.startTime, end: input.endTime }, { date: o.date, start: o.startTime, end: o.endTime }));
    if (hit) throw new DomainError(`That clashes with their shift on ${hit.date} from ${hit.startTime} to ${hit.endTime}.`);
    const s = await tx.rosterShift.create({ data: { businessId, branchId, userId: input.userId, date: input.date, startTime: input.startTime, endTime: input.endTime, note } });
    await audit(tx, ctx, "roster.add", "RosterShift", s.id, { userId: input.userId, date: input.date });
    return s;
  });
}

export async function removeRosterShift(ctx: TenantContext, id: string) {
  needRoster(ctx);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const r = await tx.rosterShift.deleteMany({ where: { id, businessId, branchId } });
    if (r.count === 0) throw new DomainError("Shift not found.");
    await audit(tx, ctx, "roster.remove", "RosterShift", id);
  });
}

/** Copies one week's shifts to another week, skipping any that would clash with what is already there. Returns how many were copied. */
export async function copyWeek(ctx: TenantContext, fromDate: string, toDate: string) {
  needRoster(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!isValidDate(fromDate) || !isValidDate(toDate)) throw new DomainError("Choose valid dates.");
  const from = weekStartOf(fromDate);
  const to = weekStartOf(toDate);
  if (from === to) throw new DomainError("Choose a different week to copy to.");
  const offset = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  const source = await db.rosterShift.findMany({ where: { businessId, branchId, date: { gte: from, lte: addDays(from, 6) } } });
  if (source.length === 0) throw new DomainError("That week has no shifts to copy.");
  const staff = new Set((await rosterStaff(businessId, branchId)).map((s) => s.userId));
  return db.$transaction(async (tx) => {
    let copied = 0;
    for (const s of source) {
      if (!staff.has(s.userId)) continue;
      const date = addDays(s.date, offset);
      const near = await tx.rosterShift.findMany({ where: { businessId, userId: s.userId, date: { in: [addDays(date, -1), date, addDays(date, 1)] } } });
      if (near.some((o) => clashes({ date, start: s.startTime, end: s.endTime }, { date: o.date, start: o.startTime, end: o.endTime }))) continue;
      await tx.rosterShift.create({ data: { businessId, branchId, userId: s.userId, date, startTime: s.startTime, endTime: s.endTime, note: s.note } });
      copied++;
    }
    await audit(tx, ctx, "roster.copy", "RosterShift", to, { from, to, copied });
    return copied;
  });
}

// ---------------------------------------------------------------------------------------------------
// tips

function needDrawer(ctx: TenantContext) {
  if (!can(ctx.role, "drawer.use")) throw new DomainError("You do not have permission to record tips.");
}
function needPayroll(ctx: TenantContext) {
  if (!can(ctx.role, "payroll.manage")) throw new DomainError("Only the owner can share out tips.");
}

export async function recordTip(ctx: TenantContext, input: { date: string; amount: number; method: string; note?: string }) {
  needDrawer(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!isValidDate(input.date)) throw new DomainError("Choose a valid date.");
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > 100_000_000) throw new DomainError("Enter the tip as an amount above zero.");
  if (!["CASH", "CARD", "QR"].includes(input.method)) throw new DomainError("Choose how the tip was paid.");
  const biz = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: biz.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (input.date > today) throw new DomainError("A tip cannot be dated in the future.");
  const note = (input.note ?? "").trim().replace(/\s+/g, " ").slice(0, 80) || null;
  return db.$transaction(async (tx) => {
    const t = await tx.tipEntry.create({ data: { businessId, branchId, date: input.date, amount: input.amount, method: input.method as "CASH" | "CARD" | "QR", note, createdById: ctx.userId } });
    await audit(tx, ctx, "tip.record", "TipEntry", t.id, { amount: input.amount, method: input.method });
    return t;
  });
}

export async function listTips(ctx: TenantContext, from: string, to: string) {
  if (!can(ctx.role, "drawer.use") && !can(ctx.role, "payroll.manage")) throw new DomainError("You do not have permission to see tips.");
  if (!isValidDate(from) || !isValidDate(to) || from > to) throw new DomainError("Choose valid dates.");
  const { businessId, branchId } = scope(ctx);
  const rows = await db.tipEntry.findMany({ where: { businessId, branchId, date: { gte: from, lte: to } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500 });
  const payouts = can(ctx.role, "payroll.manage")
    ? await db.tipPayout.findMany({ where: { businessId, branchId }, orderBy: { createdAt: "desc" }, take: 10, include: { lines: { orderBy: { amount: "desc" } } } })
    : [];
  return { tips: rows, unshared: rows.filter((r) => !r.payoutId).reduce((n, r) => n + r.amount, 0), payouts };
}

/** Minutes each person worked at this branch in a period, from the time clock (clock-in to clock-out; a person still clocked in counts to now). */
async function minutesWorked(businessId: string, branchId: string, fromDate: string, toDate: string): Promise<Worker[]> {
  const biz = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const start = dayRange(fromDate, biz.timezone).start;
  const end = dayRange(toDate, biz.timezone).end;
  const entries = await db.timeEntry.findMany({ where: { businessId, branchId, clockIn: { gte: start, lt: end } }, include: { user: { select: { name: true } } } });
  const by = new Map<string, Worker>();
  const now = Date.now();
  for (const e of entries) {
    const mins = Math.max(0, Math.round(((e.clockOut?.getTime() ?? now) - e.clockIn.getTime()) / 60_000));
    const w = by.get(e.userId) ?? { userId: e.userId, name: e.user.name, minutes: 0 };
    w.minutes += mins;
    by.set(e.userId, w);
  }
  return [...by.values()];
}

export interface PayoutInput {
  from: string;
  to: string;
  basis: string;
  /** How much of the service charge collected in the period joins the pool, 0 to 100. */
  servicePercent: number;
}

async function plan(ctx: TenantContext, input: PayoutInput) {
  const { businessId, branchId } = scope(ctx);
  if (!isValidDate(input.from) || !isValidDate(input.to) || input.from > input.to) throw new DomainError("Choose valid dates.");
  if (input.basis !== "HOURS" && input.basis !== "EQUAL") throw new DomainError("Choose how to share: by hours or equally.");
  if (!(input.servicePercent >= 0 && input.servicePercent <= 100)) throw new DomainError("The service charge share must be 0 to 100 percent.");
  const biz = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const start = dayRange(input.from, biz.timezone).start;
  const end = dayRange(input.to, biz.timezone).end;
  const [tips, service, workers] = await Promise.all([
    db.tipEntry.findMany({ where: { businessId, branchId, payoutId: null, date: { gte: input.from, lte: input.to } } }),
    db.invoice.aggregate({ where: { businessId, branchId, createdAt: { gte: start, lt: end } }, _sum: { serviceCharge: true } }),
    minutesWorked(businessId, branchId, input.from, input.to),
  ]);
  const tipsAmount = tips.reduce((n, t) => n + t.amount, 0);
  const serviceAmount = Math.round(((service._sum.serviceCharge ?? 0) * input.servicePercent) / 100);
  const pooled = tipsAmount + serviceAmount;
  const lines = shareOut(pooled, workers, input.basis);
  return { tips, tipsAmount, serviceAmount, pooled, lines, serviceCollected: service._sum.serviceCharge ?? 0 };
}

/** What sharing would give each person, without saving anything. */
export async function previewPayout(ctx: TenantContext, input: PayoutInput) {
  needPayroll(ctx);
  const p = await plan(ctx, input);
  return { tipsAmount: p.tipsAmount, serviceAmount: p.serviceAmount, serviceCollected: p.serviceCollected, pooled: p.pooled, tipCount: p.tips.length, lines: p.lines };
}

/**
 * Shares the tips (and the chosen part of the service charge) out, marks those tips as shared, and adds each person's share to payroll as a
 * bonus for the month the period ends in. Refused when payroll for that month is already finalized.
 */
export async function createPayout(ctx: TenantContext, input: PayoutInput) {
  needPayroll(ctx);
  const { businessId, branchId } = scope(ctx);
  const p = await plan(ctx, input);
  if (p.pooled <= 0) throw new DomainError("There is nothing to share out in that period.");
  if (p.lines.length === 0) throw new DomainError("Nobody clocked in at this branch in that period, so there is no one to share with.");
  const period = input.to.slice(0, 7);
  const [y, m] = period.split("-").map(Number);
  const monthStart = `${period}-01`;
  const monthEnd = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  return db.$transaction(async (tx) => {
    if (await tx.payrollRun.findFirst({ where: { businessId, periodStart: { lte: monthEnd }, periodEnd: { gte: monthStart } }, select: { id: true } })) {
      throw new DomainError("Payroll for that month is already finalized. Share the tips in a period that ends in an open month.");
    }
    // Take the tips first: only the ones still unshared, so two people cannot share the same tips twice.
    const claimed = await tx.tipEntry.updateMany({ where: { id: { in: p.tips.map((t) => t.id) }, payoutId: null }, data: { payoutId: "pending" } });
    if (claimed.count !== p.tips.length) throw new DomainError("Those tips were just shared by someone else. Look again.");
    const payout = await tx.tipPayout.create({
      data: { businessId, branchId, fromDate: input.from, toDate: input.to, pooled: p.pooled, tipsAmount: p.tipsAmount, serviceAmount: p.serviceAmount, basis: input.basis, createdById: ctx.userId },
    });
    await tx.tipEntry.updateMany({ where: { id: { in: p.tips.map((t) => t.id) } }, data: { payoutId: payout.id } });
    for (const l of p.lines) {
      if (l.amount <= 0) continue;
      const adj = await tx.payAdjustment.create({
        data: { businessId, userId: l.userId, period, kind: "BONUS", amount: l.amount, note: `Tips and service charge share, ${input.from} to ${input.to}`, createdById: ctx.userId },
      });
      await tx.tipPayoutLine.create({ data: { businessId, payoutId: payout.id, userId: l.userId, name: l.name, minutes: l.minutes, amount: l.amount, adjustmentId: adj.id } });
    }
    await audit(tx, ctx, "tip.payout", "TipPayout", payout.id, { pooled: p.pooled, people: p.lines.length, period });
    return payout;
  });
}
