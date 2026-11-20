import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { dayRange } from "@/lib/business-day";
import { isPeriod, monthBounds } from "@/features/payroll/payroll";
import { checkClockIn, clampRadius, distanceFromBranch, parseClockLocation, type BranchPoint } from "@/features/payroll/clock-location";
import { pushToTeam } from "@/features/notifications/server/push";
import { publishLiveSoon } from "@/server/live";

/**
 * Clocking in and out, and managers correcting hours. Everyone clocks themselves; managers see and fix the team's time
 * for the branches they work in. A month that has been finalized in payroll is locked: its hours cannot change.
 * Every query is filtered by businessId.
 */

const MAX_SHIFT_MS = 16 * 60 * 60 * 1000;

function needManage(ctx: TenantContext) {
  if (!can(ctx, "time.manage")) throw new DomainError("You do not have permission to change staff time.");
}

async function timezone(businessId: string) {
  return (await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } })).timezone;
}

/** The YYYY-MM month an instant falls in, in the business's own calendar. */
export function monthOf(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(instant).slice(0, 7);
}

async function assertMonthOpen(client: Pick<typeof db, "payrollRun">, businessId: string, instant: Date, tz: string) {
  const { start, end } = monthBounds(monthOf(instant, tz));
  const run = await client.payrollRun.findFirst({ where: { businessId, periodStart: start, periodEnd: end }, select: { id: true } });
  if (run) throw new DomainError("Payroll for that month is finalized, so its hours cannot be changed.");
}

// --- clocking ------------------------------------------------------------------------

async function branchPoint(businessId: string, branchId: string): Promise<BranchPoint> {
  const b = await db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId, id: branchId } }, select: { name: true, latitude: true, longitude: true, clockRadiusMeters: true } });
  return { name: b.name, latitude: b.latitude, longitude: b.longitude, radius: b.clockRadiusMeters };
}

const hhmm = (d: Date, tz: string) => d.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

/** Tell the owner and managers of the branch, on their phones and in the app. Never blocks or fails the clocking. */
function announce(ctx: TenantContext, title: string, body: string, topic: string) {
  void pushToTeam({ businessId: ctx.businessId, branchId: ctx.branchId, permission: "time.manage", payload: { title, body, url: "/attendance", tag: `clock-${ctx.userId}` } });
  publishLiveSoon({ businessId: ctx.businessId, branchId: ctx.branchId, topic });
}

/**
 * Clock in. When the business requires location, the phone must report a reading at the branch (inside its radius, and
 * exact enough); otherwise the reading is optional and only used to note the distance. No coordinates are stored, only
 * the distance from the branch.
 */
export async function clockIn(ctx: TenantContext, rawLocation?: unknown) {
  const loc = parseClockLocation(rawLocation);
  const [business, branch] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { clockRequireLocation: true, timezone: true } }),
    branchPoint(ctx.businessId, ctx.branchId),
  ]);
  let distance: number | null = null;
  if (business.clockRequireLocation) {
    const check = checkClockIn(branch, loc);
    if (!check.ok) throw new DomainError(check.reason);
    distance = check.distance;
  } else {
    distance = distanceFromBranch(branch, loc);
  }
  const { entry, name } = await db.$transaction(async (tx) => {
    // Lock this person's membership so two taps (two devices) cannot start two shifts.
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId" = ${ctx.userId} AND "businessId" = ${ctx.businessId} FOR UPDATE`;
    const open = await tx.timeEntry.findFirst({ where: { businessId: ctx.businessId, userId: ctx.userId, clockOut: null } });
    if (open) throw new DomainError("You are already clocked in.");
    const entry = await tx.timeEntry.create({
      data: { businessId: ctx.businessId, branchId: ctx.branchId, userId: ctx.userId, clockIn: new Date(), source: "CLOCK", inDistanceM: distance },
    });
    const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } });
    return { entry, name: user.name };
  });
  announce(ctx, `${name} clocked in`, `At ${hhmm(entry.clockIn, business.timezone)}${distance !== null ? ` · ${distance} m from ${branch.name}` : ""}`, "clock.in");
  return entry;
}

/**
 * Clock out. Location is checked when the phone gives it, but being away is allowed (people leave, phones die, and nobody
 * should be stuck on the clock): it is recorded, and the owner is told the person clocked out away from the branch.
 */
export async function clockOut(ctx: TenantContext, rawLocation?: unknown) {
  const loc = parseClockLocation(rawLocation);
  const now = new Date();
  const [business, open] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } }),
    db.timeEntry.findFirst({ where: { businessId: ctx.businessId, userId: ctx.userId, clockOut: null } }),
  ]);
  if (!open) throw new DomainError("You are not clocked in.");
  const branch = await branchPoint(ctx.businessId, open.branchId);
  const distance = distanceFromBranch(branch, loc);
  const away = distance !== null && distance > branch.radius;
  const closed = await db.timeEntry.updateMany({
    where: { id: open.id, businessId: ctx.businessId, userId: ctx.userId, clockOut: null },
    data: { clockOut: now, outDistanceM: distance, outAway: away },
  });
  if (closed.count === 0) throw new DomainError("You are not clocked in.");
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } });
  const mins = Math.round((now.getTime() - open.clockIn.getTime()) / 60_000);
  const worked = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  announce(
    { ...ctx, branchId: open.branchId },
    `${user.name} clocked out`,
    `At ${hhmm(now, business.timezone)} · worked ${worked}${away ? ` · ${distance} m away from ${branch.name}` : distance === null ? " · location not checked" : ""}`,
    "clock.out",
  );
}

/** Whether the signed-in person is clocked in, and for how long today. */
export async function myClock(ctx: TenantContext) {
  const tz = await timezone(ctx.businessId);
  const { start } = dayRange(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()), tz);
  const [open, today] = await Promise.all([
    db.timeEntry.findFirst({ where: { businessId: ctx.businessId, userId: ctx.userId, clockOut: null } }),
    db.timeEntry.findMany({ where: { businessId: ctx.businessId, userId: ctx.userId, clockIn: { gte: start }, clockOut: { not: null } }, select: { clockIn: true, clockOut: true } }),
  ]);
  const doneMs = today.reduce((n, e) => n + (e.clockOut!.getTime() - e.clockIn.getTime()), 0);
  return { since: open?.clockIn ?? null, workedTodayMinutes: Math.round(doneMs / 60_000) };
}

// --- looking at time ------------------------------------------------------------------

/** Entries for one month. Without `userId` it is your own; for someone else you need time.manage and a shared branch. */
export async function listTimeEntries(ctx: TenantContext, input: { period: string; userId?: string }) {
  if (!isPeriod(input.period)) throw new DomainError("Choose a month.");
  const tz = await timezone(ctx.businessId);
  const { start, end } = monthBounds(input.period);
  const range = { gte: dayRange(start, tz).start, lt: dayRange(end, tz).end };
  const wanted = input.userId ?? ctx.userId;
  if (wanted !== ctx.userId) {
    needManage(ctx);
    const m = await db.membership.findFirst({
      where: { businessId: ctx.businessId, userId: wanted, OR: [{ allBranches: true }, { branches: { some: { branchId: { in: ctx.branchIds } } } }] },
    });
    if (!m) throw new DomainError("Staff member not found.");
  }
  const rows = await db.timeEntry.findMany({
    where: { businessId: ctx.businessId, userId: wanted, clockIn: range },
    orderBy: { clockIn: "desc" },
  });
  return rows;
}

/** Who is clocked in right now in the branches the manager works in. */
export async function whoIsIn(ctx: TenantContext) {
  needManage(ctx);
  const rows = await db.timeEntry.findMany({
    where: { businessId: ctx.businessId, clockOut: null, branchId: { in: ctx.branchIds } },
    include: { user: { select: { name: true } } },
    orderBy: { clockIn: "asc" },
  });
  return rows.map((r) => ({ id: r.id, userId: r.userId, name: r.user.name, since: r.clockIn, branchId: r.branchId }));
}

/** The people whose time this manager can see: staff of the branches they work in. */
export async function listTeam(ctx: TenantContext) {
  needManage(ctx);
  const rows = await db.membership.findMany({
    where: {
      businessId: ctx.businessId,
      OR: [{ allBranches: true }, { branches: { some: { branchId: { in: ctx.branchIds } } } }],
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({ userId: m.user.id, name: m.user.name, role: m.role }));
}

// --- corrections ----------------------------------------------------------------------

function checkTimes(clockIn: Date, clockOut: Date | null) {
  if (Number.isNaN(clockIn.getTime()) || (clockOut && Number.isNaN(clockOut.getTime()))) throw new DomainError("Enter valid times.");
  const now = Date.now();
  if (clockIn.getTime() > now + 60_000 || (clockOut && clockOut.getTime() > now + 60_000)) throw new DomainError("Times cannot be in the future.");
  if (clockOut) {
    if (clockOut <= clockIn) throw new DomainError("Clock out must be after clock in.");
    if (clockOut.getTime() - clockIn.getTime() > MAX_SHIFT_MS) throw new DomainError("A shift cannot be longer than 16 hours.");
  }
}

async function assertNoOverlap(
  tx: Pick<typeof db, "timeEntry">,
  businessId: string,
  userId: string,
  clockIn: Date,
  clockOut: Date | null,
  exceptId?: string,
) {
  const end = clockOut ?? new Date(clockIn.getTime() + MAX_SHIFT_MS);
  const clash = await tx.timeEntry.findFirst({
    where: {
      businessId,
      userId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      clockIn: { lt: end },
      OR: [{ clockOut: null }, { clockOut: { gt: clockIn } }],
    },
  });
  if (clash) throw new DomainError("That overlaps another shift for this person.");
}

export async function addManualEntry(ctx: TenantContext, input: { userId: string; clockIn: Date; clockOut: Date; note?: string }) {
  needManage(ctx);
  checkTimes(input.clockIn, input.clockOut);
  const note = input.note?.trim().replace(/\s+/g, " ").slice(0, 200) || null;
  const tz = await timezone(ctx.businessId);
  return db.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({
      where: { businessId: ctx.businessId, userId: input.userId, OR: [{ allBranches: true }, { branches: { some: { branchId: { in: ctx.branchIds } } } }] },
    });
    if (!m) throw new DomainError("Staff member not found.");
    await assertMonthOpen(tx, ctx.businessId, input.clockIn, tz);
    await assertNoOverlap(tx, ctx.businessId, input.userId, input.clockIn, input.clockOut);
    const e = await tx.timeEntry.create({
      data: { businessId: ctx.businessId, branchId: ctx.branchId, userId: input.userId, clockIn: input.clockIn, clockOut: input.clockOut, source: "MANUAL", note, editedById: ctx.userId },
    });
    await audit(tx, ctx, "time.add", "TimeEntry", e.id, { userId: input.userId, clockIn: input.clockIn.toISOString(), clockOut: input.clockOut.toISOString() });
    return e;
  });
}

export async function editEntry(ctx: TenantContext, id: string, input: { clockIn: Date; clockOut: Date | null; note?: string }) {
  needManage(ctx);
  checkTimes(input.clockIn, input.clockOut);
  const note = input.note?.trim().replace(/\s+/g, " ").slice(0, 200) || null;
  const tz = await timezone(ctx.businessId);
  await db.$transaction(async (tx) => {
    const e = await tx.timeEntry.findFirst({ where: { id, businessId: ctx.businessId, branchId: { in: ctx.branchIds } } });
    if (!e) throw new DomainError("Time entry not found.");
    await assertMonthOpen(tx, ctx.businessId, e.clockIn, tz);
    await assertMonthOpen(tx, ctx.businessId, input.clockIn, tz);
    await assertNoOverlap(tx, ctx.businessId, e.userId, input.clockIn, input.clockOut, e.id);
    await tx.timeEntry.update({ where: { id }, data: { clockIn: input.clockIn, clockOut: input.clockOut, note, editedById: ctx.userId } });
    await audit(tx, ctx, "time.edit", "TimeEntry", id, {
      before: { clockIn: e.clockIn.toISOString(), clockOut: e.clockOut?.toISOString() ?? null },
      after: { clockIn: input.clockIn.toISOString(), clockOut: input.clockOut?.toISOString() ?? null },
    });
  });
}

export async function removeEntry(ctx: TenantContext, id: string, reason: string) {
  needManage(ctx);
  const why = reason.trim().replace(/\s+/g, " ").slice(0, 200);
  if (why.length < 3) throw new DomainError("Say why (a few words).");
  const tz = await timezone(ctx.businessId);
  await db.$transaction(async (tx) => {
    const e = await tx.timeEntry.findFirst({ where: { id, businessId: ctx.businessId, branchId: { in: ctx.branchIds } } });
    if (!e) throw new DomainError("Time entry not found.");
    await assertMonthOpen(tx, ctx.businessId, e.clockIn, tz);
    await tx.timeEntry.delete({ where: { id } });
    await audit(tx, ctx, "time.remove", "TimeEntry", id, { reason: why, userId: e.userId, clockIn: e.clockIn.toISOString(), clockOut: e.clockOut?.toISOString() ?? null });
  });
}

// --- location setting ---------------------------------------------------------------

export async function getClockSettings(ctx: TenantContext) {
  needManage(ctx);
  const [business, branch] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { clockRequireLocation: true } }),
    branchPoint(ctx.businessId, ctx.branchId),
  ]);
  return { requireLocation: business.clockRequireLocation, branchName: branch.name, hasLocation: branch.latitude !== null && branch.longitude !== null, radius: branch.radius };
}

/** Switch the "must be at the branch to clock in" rule on or off, and set how close that means for the branch you are in. */
export async function setClockSettings(ctx: TenantContext, input: { requireLocation: boolean; radius: number }) {
  needManage(ctx);
  if (!Number.isFinite(input.radius)) throw new DomainError("Enter the distance in metres.");
  const radius = clampRadius(input.radius);
  const branch = await branchPoint(ctx.businessId, ctx.branchId);
  if (input.requireLocation && (branch.latitude === null || branch.longitude === null)) {
    throw new DomainError(`Set ${branch.name}'s location on the Branches page first, so there is somewhere to check against.`);
  }
  await db.$transaction(async (tx) => {
    await tx.business.update({ where: { id: ctx.businessId }, data: { clockRequireLocation: input.requireLocation } });
    await tx.branch.update({ where: { businessId_id: { businessId: ctx.businessId, id: ctx.branchId } }, data: { clockRadiusMeters: radius } });
    await audit(tx, ctx, "time.settings", "Business", ctx.businessId, { requireLocation: input.requireLocation, radius });
  });
}

// --- who came, who was off -------------------------------------------------------------

export interface AttendanceRow {
  userId: string;
  name: string;
  role: string;
  /** IN: clocked in and not out yet. DONE: worked today and clocked out. OFF: no time recorded that day. */
  status: "IN" | "DONE" | "OFF";
  firstIn: Date | null;
  lastOut: Date | null;
  minutes: number;
  shifts: number;
  /** Clocked in from a phone more than the branch radius away (only possible when location is not required), or out while away. */
  awayOut: boolean;
  inDistanceM: number | null;
}

/** One day's attendance for the staff of the branches this manager works in, in the business's own calendar. */
export async function getAttendance(ctx: TenantContext, date: string) {
  needManage(ctx);
  const tz = await timezone(ctx.businessId);
  const { start, end } = dayRange(date, tz);
  const team = await db.membership.findMany({
    where: {
      businessId: ctx.businessId,
      role: { not: "RIDER" },
      OR: [{ allBranches: true }, { branches: { some: { branchId: { in: ctx.branchIds } } } }],
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const entries = await db.timeEntry.findMany({
    where: { businessId: ctx.businessId, branchId: { in: ctx.branchIds }, clockIn: { gte: start, lt: end } },
    orderBy: { clockIn: "asc" },
  });
  const now = Date.now();
  const rows: AttendanceRow[] = team.map((m) => {
    const mine = entries.filter((e) => e.userId === m.userId);
    const open = mine.find((e) => !e.clockOut);
    const minutes = mine.reduce((n, e) => n + Math.max(0, Math.round(((e.clockOut ?? new Date(now)).getTime() - e.clockIn.getTime()) / 60_000)), 0);
    const outs = mine.filter((e) => e.clockOut);
    return {
      userId: m.user.id,
      name: m.user.name,
      role: m.role,
      status: open ? "IN" : mine.length ? "DONE" : "OFF",
      firstIn: mine[0]?.clockIn ?? null,
      lastOut: outs.length ? outs[outs.length - 1]!.clockOut : null,
      minutes,
      shifts: mine.length,
      awayOut: mine.some((e) => e.outAway),
      inDistanceM: mine[0]?.inDistanceM ?? null,
    };
  });
  return {
    date,
    timezone: tz,
    rows,
    counts: { in: rows.filter((r) => r.status === "IN").length, done: rows.filter((r) => r.status === "DONE").length, off: rows.filter((r) => r.status === "OFF").length },
  };
}
