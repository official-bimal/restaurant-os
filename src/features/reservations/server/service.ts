import { sortNatural } from "@/lib/natural";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { normalizePhone } from "@/server/phone";
import { randomKey } from "@/lib/random-key";
import { isValidDate, localDate } from "@/lib/business-day";
import { getProvider } from "@/features/messaging/providers";
import { bookingProblem, canMove, clash, confirmationText, declineText, type ReservationStatus } from "../reservations";

/**
 * Table reservations. A guest asks from the branch's public page; staff confirm, decline, seat or mark no-show, or take a booking over the phone.
 * Confirming sends a text if an SMS provider is set up; either way the page gives a WhatsApp link and the number to call, so the guest is told
 * by a person if no provider is configured. Every staff query is filtered by businessId and the branch the person works in.
 */

function need(ctx: TenantContext) {
  if (!can(ctx, "order.edit")) throw new DomainError("You do not have permission to handle reservations.");
}

function nowIn(timezone: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { today: localDate(now, timezone), minute: get("hour") * 60 + get("minute") };
}

const MAX_OPEN_PER_PHONE = 3;

// ---------------------------------------------------------------------------------------------------
// the guest side (no sign-in)

export async function lookupReservationBranch(token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null;
  const b = await db.branch.findUnique({ where: { onlineToken: token }, include: { business: { select: { name: true } } } });
  if (!b || !b.active) return null;
  return { branchId: b.id, businessId: b.businessId, businessName: b.business.name, branchName: b.name, enabled: b.reservationsEnabled };
}

export async function submitReservationRequest(token: string, input: { name: string; phone: string; partySize: number; date: string; time: string; note?: string }) {
  const branch = await lookupReservationBranch(token);
  if (!branch) throw new DomainError("This page is not available.");
  if (!branch.enabled) throw new DomainError("This place is not taking table requests on this page right now. Please call us.");
  let phone: string;
  try {
    phone = normalizePhone(input.phone);
  } catch {
    throw new DomainError("Enter a phone number we can reach you on.");
  }
  const biz = await db.business.findUniqueOrThrow({ where: { id: branch.businessId }, select: { timezone: true } });
  const { today, minute } = nowIn(biz.timezone);
  const problem = bookingProblem(input, today, minute);
  if (problem) throw new DomainError(problem);
  const note = (input.note ?? "").trim().replace(/\s+/g, " ").slice(0, 200) || null;
  // One person cannot hold many tables: a few open requests at a time.
  const open = await db.reservation.count({ where: { businessId: branch.businessId, branchId: branch.branchId, phone, date: { gte: today }, status: { in: ["REQUESTED", "CONFIRMED"] } } });
  if (open >= MAX_OPEN_PER_PHONE) throw new DomainError("You already have bookings waiting. Please call us to change them.");
  const r = await db.reservation.create({
    data: { businessId: branch.businessId, branchId: branch.branchId, name: input.name.trim().replace(/\s+/g, " "), phone, partySize: input.partySize, date: input.date, time: input.time, note, source: "ONLINE", token: randomKey() },
  });
  return { token: r.token };
}

/** The guest's own booking, by the private link they were given. Nothing about anyone else. */
export async function getReservationByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null;
  const r = await db.reservation.findUnique({ where: { token } });
  if (!r) return null;
  const biz = await db.business.findUniqueOrThrow({ where: { id: r.businessId }, select: { name: true } });
  return { name: r.name, partySize: r.partySize, date: r.date, time: r.time, status: r.status as ReservationStatus, businessName: biz.name };
}

/** The guest takes their own request back. */
export async function cancelOwnReservation(token: string) {
  const r = await db.reservation.findUnique({ where: { token } });
  if (!r) throw new DomainError("Booking not found.");
  if (!canMove(r.status, "CANCELLED")) throw new DomainError("This booking can no longer be cancelled here. Please call us.");
  await db.reservation.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
}

// ---------------------------------------------------------------------------------------------------
// the staff side

export async function listReservations(ctx: TenantContext, date: string) {
  need(ctx);
  if (!isValidDate(date)) throw new DomainError("Choose a valid date.");
  const { businessId, branchId } = scope(ctx);
  const [rows, tables, branch, biz] = await Promise.all([
    db.reservation.findMany({ where: { businessId, branchId, date }, orderBy: [{ time: "asc" }, { createdAt: "asc" }] }),
    db.diningTable.findMany({ where: { businessId, branchId }, orderBy: { label: "asc" }, select: { id: true, label: true, capacity: true } }),
    db.branch.findFirstOrThrow({ where: { id: branchId, businessId }, select: { reservationsEnabled: true, onlineToken: true } }),
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true } }),
  ]);
  return { rows, tables: sortNatural(tables, (t) => t.label), enabled: branch.reservationsEnabled, publicToken: branch.onlineToken, businessName: biz.name };
}

export async function reservationsWaitingCount(ctx: TenantContext): Promise<number> {
  if (!can(ctx, "order.edit") || !ctx.branchId) return 0;
  const biz = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  return db.reservation.count({ where: { businessId: ctx.businessId, branchId: ctx.branchId, status: "REQUESTED", date: { gte: localDate(new Date(), biz.timezone) } } });
}

/** A booking taken by staff (a phone call or a walk-in who wants later): confirmed straight away. */
export async function createReservation(ctx: TenantContext, input: { name: string; phone: string; partySize: number; date: string; time: string; tableId?: string; note?: string }) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  let phone: string;
  try {
    phone = normalizePhone(input.phone);
  } catch {
    throw new DomainError("Enter the guest's phone number.");
  }
  const biz = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const { today, minute } = nowIn(biz.timezone);
  const problem = bookingProblem(input, today, minute);
  if (problem) throw new DomainError(problem);
  return db.$transaction(async (tx) => {
    if (input.tableId) await assertTableFree(tx, businessId, branchId, input.tableId, input.date, input.time, null);
    const r = await tx.reservation.create({
      data: {
        businessId, branchId, name: input.name.trim().replace(/\s+/g, " "), phone, partySize: input.partySize, date: input.date, time: input.time,
        tableId: input.tableId || null, status: "CONFIRMED", confirmedAt: new Date(), note: (input.note ?? "").trim().slice(0, 200) || null, source: "STAFF", token: randomKey(), createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, "reservation.create", "Reservation", r.id, { date: r.date, time: r.time, partySize: r.partySize });
    return r;
  });
}

async function assertTableFree(tx: Pick<typeof db, "diningTable" | "reservation">, businessId: string, branchId: string, tableId: string, date: string, time: string, exceptId: string | null) {
  const table = await tx.diningTable.findFirst({ where: { id: tableId, businessId, branchId } });
  if (!table) throw new DomainError("Table not found.");
  const others = await tx.reservation.findMany({ where: { businessId, branchId, tableId, date, status: { in: ["CONFIRMED", "SEATED"] }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { time: true, date: true, name: true } });
  const c = others.find((o) => clash({ date, time }, o));
  if (c) throw new DomainError(`${table.label} is already booked for ${c.name} at ${c.time}. Choose another table or time.`);
}

export interface StatusResult {
  sms: "sent" | "failed" | "not-set-up" | "not-sent";
  message?: string;
}

/** Moves a booking on. Confirming or declining also tries to text the guest (when an SMS provider is set up). */
export async function setReservationStatus(ctx: TenantContext, id: string, to: ReservationStatus, opts: { tableId?: string } = {}): Promise<StatusResult> {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const r = await db.$transaction(async (tx) => {
    const cur = await tx.reservation.findFirst({ where: { id, businessId, branchId } });
    if (!cur) throw new DomainError("Booking not found.");
    if (!canMove(cur.status, to)) throw new DomainError("That booking cannot be changed to that.");
    const tableId = opts.tableId || cur.tableId;
    if (to === "CONFIRMED" && tableId) await assertTableFree(tx, businessId, branchId, tableId, cur.date, cur.time, cur.id);
    const next = await tx.reservation.update({ where: { id: cur.id }, data: { status: to, tableId: tableId || null, ...(to === "CONFIRMED" ? { confirmedAt: new Date() } : {}) } });
    await audit(tx, ctx, `reservation.${to.toLowerCase()}`, "Reservation", cur.id, { name: cur.name });
    return next;
  });
  if (to !== "CONFIRMED" && to !== "CANCELLED") return { sms: "not-sent" };
  // Only a request the guest made themselves, or a cancellation of a booking the guest knows about, is worth a text.
  const biz = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true } });
  const provider = getProvider();
  if (!provider) return { sms: "not-set-up" };
  const text = to === "CONFIRMED" ? confirmationText(r, biz.name) : declineText(r, biz.name);
  const res = await provider.send(r.phone, text);
  return res.ok ? { sms: "sent" } : { sms: "failed", message: res.error };
}

export async function setReservationsEnabled(ctx: TenantContext, enabled: boolean) {
  if (!can(ctx, "branch.manage")) throw new DomainError("Only the owner can turn reservations on or off.");
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const b = await tx.branch.findFirst({ where: { id: branchId, businessId } });
    if (!b) throw new DomainError("Branch not found.");
    if (enabled && !b.onlineToken) throw new DomainError("This branch has no public link yet. Set up online ordering first (Online orders, settings) to get the link.");
    await tx.branch.update({ where: { businessId_id: { businessId, id: branchId } }, data: { reservationsEnabled: enabled } });
    await audit(tx, ctx, enabled ? "reservation.open" : "reservation.close", "Branch", branchId);
  });
}

