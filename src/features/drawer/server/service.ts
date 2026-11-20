import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { Prisma } from "@/generated/prisma/client";
import { difference, expectedCash, isMoneyIn, MOVE_KINDS, type MoveKind } from "../drawer";

/**
 * The cash drawer of the branch the person works in: open it with a float, put cash in or take it out with a reason, and count it at handover.
 * Only one drawer shift is open per branch at a time. The count is compared with what the drawer should hold (float, cash sales, refunds, cash moved,
 * cash tips); any difference needs a reason and is posted to the books so the cash account matches the real count. Every query is filtered by
 * businessId and branch.
 */

const MAX = 100_000_000_000;

function needUse(ctx: TenantContext) {
  if (!can(ctx, "drawer.use")) throw new DomainError("You do not have permission to use the cash drawer.");
}

async function flows(businessId: string, branchId: string, from: Date, to: Date, shiftId: string, openingFloat: number) {
  const [sales, refunds, moves, tips] = await Promise.all([
    db.payment.aggregate({ where: { businessId, method: "CASH", invoice: { branchId }, createdAt: { gte: from, lte: to } }, _sum: { amount: true } }),
    db.refundPayment.aggregate({ where: { businessId, method: "CASH", creditNote: { invoice: { branchId }, createdAt: { gte: from, lte: to } } }, _sum: { amount: true } }),
    db.cashMovement.findMany({ where: { businessId, shiftId }, orderBy: { createdAt: "asc" } }),
    db.tipEntry.aggregate({ where: { businessId, branchId, method: "CASH", createdAt: { gte: from, lte: to } }, _sum: { amount: true } }),
  ]);
  const f = { openingFloat, cashSales: sales._sum.amount ?? 0, cashRefunds: refunds._sum.amount ?? 0, moves: moves.map((m) => ({ kind: m.kind as MoveKind, amount: m.amount })), cashTips: tips._sum.amount ?? 0 };
  return { ...f, expected: expectedCash(f), movements: moves };
}

export async function getDrawer(ctx: TenantContext) {
  if (!can(ctx, "drawer.use") && !can(ctx, "drawer.review")) throw new DomainError("You do not have permission to see the cash drawer.");
  const { businessId, branchId } = scope(ctx);
  const open = await db.cashShift.findFirst({ where: { businessId, branchId, closedAt: null } });
  const last = await db.cashShift.findFirst({ where: { businessId, branchId, closedAt: { not: null } }, orderBy: { closedAt: "desc" }, select: { countedCash: true } });
  const names = async (ids: (string | null)[]) => new Map((await db.user.findMany({ where: { id: { in: ids.filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const current = open ? { shift: open, ...(await flows(businessId, branchId, open.openedAt, new Date(), open.id, open.openingFloat)) } : null;
  const history = can(ctx, "drawer.review")
    ? await db.cashShift.findMany({ where: { businessId, branchId, closedAt: { not: null } }, orderBy: { closedAt: "desc" }, take: 30 })
    : [];
  const who = await names([open?.openedById ?? null, ...history.flatMap((h) => [h.openedById, h.closedById]), ...(current?.movements.map((m) => m.createdById) ?? [])]);
  return { current, history, lastCounted: last?.countedCash ?? null, who: Object.fromEntries(who), canReview: can(ctx, "drawer.review") };
}

export async function openShift(ctx: TenantContext, openingFloat: number) {
  needUse(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!Number.isInteger(openingFloat) || openingFloat < 0 || openingFloat > MAX) throw new DomainError("Enter the float as an amount of zero or more.");
  try {
    return await db.$transaction(async (tx) => {
      // The unique openKey lets only one shift be open per branch, even if two people press at once.
      const s = await tx.cashShift.create({ data: { businessId, branchId, openKey: branchId, openedById: ctx.userId, openingFloat } });
      await audit(tx, ctx, "drawer.open", "CashShift", s.id, { openingFloat });
      return s;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError("The drawer is already open. Count and close it first.");
    throw e;
  }
}

export async function addMovement(ctx: TenantContext, input: { kind: string; amount: number; reason: string }) {
  needUse(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!(MOVE_KINDS as string[]).includes(input.kind)) throw new DomainError("Choose what the cash was for.");
  const kind = input.kind as MoveKind;
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX) throw new DomainError("Enter the amount as a number above zero.");
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 120) throw new DomainError("Say what it was for (3 to 120 characters).");
  const shift = await db.cashShift.findFirst({ where: { businessId, branchId, closedAt: null } });
  if (!shift) throw new DomainError("Open the drawer first.");
  if (!isMoneyIn(kind)) {
    const f = await flows(businessId, branchId, shift.openedAt, new Date(), shift.id, shift.openingFloat);
    if (input.amount > f.expected) throw new DomainError("That is more cash than the drawer should hold. Check the amount.");
  }
  return db.$transaction(async (tx) => {
    const m = await tx.cashMovement.create({ data: { businessId, shiftId: shift.id, kind, amount: input.amount, reason, createdById: ctx.userId } });
    await audit(tx, ctx, "drawer.move", "CashMovement", m.id, { kind, amount: input.amount });
    return m;
  });
}

/** Counts the drawer and closes the shift. A difference needs a reason; it is kept on the shift and posted to the books. */
export async function closeShift(ctx: TenantContext, input: { countedCash: number; note?: string }) {
  needUse(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!Number.isInteger(input.countedCash) || input.countedCash < 0 || input.countedCash > MAX) throw new DomainError("Enter the cash you counted.");
  const note = (input.note ?? "").trim().replace(/\s+/g, " ").slice(0, 200) || null;
  const shift = await db.cashShift.findFirst({ where: { businessId, branchId, closedAt: null } });
  if (!shift) throw new DomainError("The drawer is not open.");
  const closedAt = new Date();
  const f = await flows(businessId, branchId, shift.openedAt, closedAt, shift.id, shift.openingFloat);
  const diff = difference(input.countedCash, f.expected);
  if (diff !== 0 && !note) throw new DomainError(`The count is ${diff < 0 ? "short" : "over"} by Rs ${Math.abs(diff) / 100}. Say why before closing.`);
  return db.$transaction(async (tx) => {
    // Claim it: only the first of two closers wins.
    const r = await tx.cashShift.updateMany({ where: { id: shift.id, closedAt: null }, data: { closedAt, closedById: ctx.userId, countedCash: input.countedCash, expectedCash: f.expected, difference: diff, note, openKey: null } });
    if (r.count === 0) throw new DomainError("The drawer was already closed.");
    await audit(tx, ctx, "drawer.close", "CashShift", shift.id, { counted: input.countedCash, expected: f.expected, difference: diff });
    return { id: shift.id, counted: input.countedCash, expected: f.expected, difference: diff };
  });
}
