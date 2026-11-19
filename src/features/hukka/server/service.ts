import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { addItem } from "@/features/orders/server/service";
import { isCoilDish, isHukkaCategory } from "../hukka";

/**
 * Hukka (shisha) timer and coil tracking for the branch the person works in. A hukka on an open order is started when it is served; it is
 * flagged once it runs past its alert time; an extra coil adds the "Extra Coil" dish to the bill and is counted; finishing (or paying the bill)
 * ends it. Every query is filtered by businessId and branch.
 */

function need(ctx: TenantContext) {
  if (!can(ctx.role, "order.edit")) throw new DomainError("You do not have permission to handle orders.");
}

const DEFAULT_ALERT = 60;

/** Sessions whose bill has been paid or cancelled are over: close them. */
async function closeFinished(businessId: string, branchId: string) {
  await db.$executeRaw`UPDATE "HukkaSession" h SET "endedAt" = NOW() FROM "Order" o WHERE h."businessId" = ${businessId} AND h."branchId" = ${branchId} AND h."endedAt" IS NULL AND o."businessId" = h."businessId" AND o."id" = h."orderId" AND o."status" IN ('PAID', 'CANCELLED', 'MERGED')`;
}

export async function getHukkaBoard(ctx: TenantContext) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  await closeFinished(businessId, branchId);
  const [running, openItems, today] = await Promise.all([
    db.hukkaSession.findMany({ where: { businessId, branchId, endedAt: null }, orderBy: { startedAt: "asc" } }),
    db.orderItem.findMany({
      where: {
        businessId,
        status: { not: "CANCELLED" },
        order: { branchId, status: { notIn: ["PAID", "CANCELLED", "MERGED"] } },
      },
      select: { id: true, name: true, quantity: true, order: { select: { id: true, number: true, table: { select: { label: true } } } }, menuItem: { select: { category: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    db.hukkaSession.findMany({ where: { businessId, branchId, startedAt: { gte: new Date(Date.now() - 24 * 3_600_000) } }, select: { startedAt: true, endedAt: true, coils: true } }),
  ]);
  const started = new Set((await db.hukkaSession.findMany({ where: { businessId, orderItemId: { in: openItems.map((i) => i.id) } }, select: { orderItemId: true } })).map((s) => s.orderItemId));
  // Each order line is timed as one hukka. Put two hukkas for one table on separate lines if they are served at different times.
  const waiting = openItems.filter((i) => isHukkaCategory(i.menuItem.category.name) && !isCoilDish(i.name) && !started.has(i.id));
  const done = today.filter((s) => s.endedAt);
  const averageMinutes = done.length ? Math.round(done.reduce((n, s) => n + (s.endedAt!.getTime() - s.startedAt.getTime()) / 60_000, 0) / done.length) : null;
  return {
    running,
    waiting: waiting.map((i) => ({ orderItemId: i.id, name: i.name, quantity: i.quantity, orderId: i.order.id, orderNumber: i.order.number, table: i.order.table?.label ?? null })),
    last24h: { started: today.length, finished: done.length, averageMinutes, coils: today.reduce((n, s) => n + s.coils, 0) },
  };
}

export async function startHukka(ctx: TenantContext, orderItemId: string, alertMinutes = DEFAULT_ALERT) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!Number.isInteger(alertMinutes) || alertMinutes < 15 || alertMinutes > 240) throw new DomainError("Choose an alert time between 15 and 240 minutes.");
  return db.$transaction(async (tx) => {
    const item = await tx.orderItem.findFirst({
      where: { id: orderItemId, businessId, status: { not: "CANCELLED" }, order: { branchId, status: { notIn: ["PAID", "CANCELLED", "MERGED"] } } },
      include: { order: { include: { table: { select: { label: true } } } }, menuItem: { select: { category: { select: { name: true } } } } },
    });
    if (!item) throw new DomainError("That item is not on an open order.");
    if (!isHukkaCategory(item.menuItem.category.name) || isCoilDish(item.name)) throw new DomainError("Only a hukka can be timed.");
    if (await tx.hukkaSession.findFirst({ where: { businessId, orderItemId } })) throw new DomainError("That hukka has already been started.");
    const s = await tx.hukkaSession.create({
      data: { businessId, branchId, orderId: item.orderId, orderItemId, name: item.name, tableLabel: item.order.table?.label ?? null, alertMinutes, startedById: ctx.userId },
    });
    await audit(tx, ctx, "hukka.start", "HukkaSession", s.id, { name: item.name, order: item.order.number });
    return s;
  });
}

/** Another coil: added to the bill as the "Extra Coil" dish, and counted on the session. */
export async function addCoil(ctx: TenantContext, sessionId: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const s = await db.hukkaSession.findFirst({ where: { id: sessionId, businessId, branchId, endedAt: null } });
  if (!s) throw new DomainError("That hukka is not running.");
  const coil = await db.menuItem.findFirst({ where: { businessId, available: true, name: { contains: "coil", mode: "insensitive" } }, select: { id: true } });
  if (!coil) throw new DomainError('Add a dish named "Extra Coil" to the menu first.');
  await addItem(ctx, s.orderId, { menuItemId: coil.id, quantity: 1 });
  await db.$transaction(async (tx) => {
    await tx.hukkaSession.update({ where: { id: s.id }, data: { coils: { increment: 1 } } });
    await audit(tx, ctx, "hukka.coil", "HukkaSession", s.id, { name: s.name });
  });
}

export async function finishHukka(ctx: TenantContext, sessionId: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const r = await tx.hukkaSession.updateMany({ where: { id: sessionId, businessId, branchId, endedAt: null }, data: { endedAt: new Date() } });
    if (r.count === 0) throw new DomainError("That hukka is not running.");
    await audit(tx, ctx, "hukka.finish", "HukkaSession", sessionId);
  });
}

/** How many hukkas are running, and how many of them are past their alert time (for a badge). */
export async function hukkaAlertCount(ctx: TenantContext): Promise<number> {
  if (!can(ctx.role, "order.edit") || !ctx.branchId) return 0;
  const rows = await db.hukkaSession.findMany({ where: { businessId: ctx.businessId, branchId: ctx.branchId, endedAt: null }, select: { startedAt: true, alertMinutes: true } });
  const now = Date.now();
  return rows.filter((r) => (now - r.startedAt.getTime()) / 60_000 >= r.alertMinutes).length;
}

/** The hukkas running now, for the kitchen or bar screen. Kitchen staff may see them as well as people who handle orders. */
export async function listRunningHukkas(ctx: TenantContext) {
  if (!can(ctx.role, "order.edit") && !can(ctx.role, "kitchen.update")) throw new DomainError("You do not have permission to see hukkas.");
  const { businessId, branchId } = scope(ctx);
  await closeFinished(businessId, branchId);
  return db.hukkaSession.findMany({ where: { businessId, branchId, endedAt: null }, orderBy: { startedAt: "asc" }, select: { id: true, name: true, tableLabel: true, startedAt: true, alertMinutes: true, coils: true } });
}
