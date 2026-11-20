import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { dayRange, localDate } from "@/lib/business-day";

/**
 * The dispatch board and each rider's account (cash they collected and have handed in, and pay earned and paid).
 * Everything is filtered by business; the board is also limited to the current branch.
 * Account entries are only ever added, never edited or deleted, so the balance can always be explained.
 */

type Db = Tx | typeof db;

function needDispatch(ctx: TenantContext) {
  if (!can(ctx, "order.edit")) throw new DomainError("You do not have permission to see deliveries.");
}
function needSettle(ctx: TenantContext) {
  if (!can(ctx, "rider.settle")) throw new DomainError("You do not have permission to handle rider cash and pay.");
}

const money = (n: number) => `Rs ${(n / 100).toLocaleString("en-US", { minimumFractionDigits: n % 100 ? 2 : 0 })}`;

// --- dispatch board ------------------------------------------------------------------

export async function getDispatchBoard(ctx: TenantContext) {
  needDispatch(ctx);
  const { businessId, branchId } = scope(ctx);
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const { start } = dayRange(localDate(new Date(), business.timezone), business.timezone);

  const orders = await db.order.findMany({
    where: {
      businessId,
      branchId,
      type: "DELIVERY",
      status: { notIn: ["CANCELLED", "MERGED"] },
      OR: [{ deliveryStatus: { in: ["PREPARING", "OUT_FOR_DELIVERY"] } }, { deliveredAt: { gte: start } }],
    },
    include: { items: { where: { status: { not: "CANCELLED" } }, select: { quantity: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });
  const card = (o: (typeof orders)[number]) => ({
    id: o.id,
    number: o.number,
    customerName: o.deliveryName,
    address: o.deliveryAddress,
    zone: o.deliveryZoneName,
    riderUserId: o.riderUserId,
    riderName: o.riderName,
    status: o.deliveryStatus!,
    paid: o.status === "PAID",
    items: o.items.reduce((n, i) => n + i.quantity, 0),
    ready: o.items.length > 0 && o.items.every((i) => i.status === "READY" || i.status === "SERVED"),
    createdAt: o.createdAt,
    deliveredAt: o.deliveredAt,
    minutesOpen: Math.floor((Date.now() - o.createdAt.getTime()) / 60_000),
    destination: o.destLat != null && o.destLng != null,
    batchId: o.batchId,
    stop: o.batchStop,
  });
  const cards = orders.map(card);

  const riders = await db.membership.findMany({
    where: { businessId, role: "RIDER", OR: [{ allBranches: true }, { branches: { some: { branchId } } }] },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const active = cards.filter((c) => c.status === "PREPARING" || c.status === "OUT_FOR_DELIVERY");
  return {
    // Deliveries grouped into a run are shown with their run, not in these columns.
    unassigned: active.filter((c) => c.status === "PREPARING" && !c.riderUserId && !c.batchId),
    waiting: active.filter((c) => c.status === "PREPARING" && c.riderUserId && !c.batchId),
    out: active.filter((c) => c.status === "OUT_FOR_DELIVERY"),
    finished: cards.filter((c) => c.status === "DELIVERED" || c.status === "FAILED").reverse(),
    riders: riders.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      load: active.filter((c) => c.riderUserId === m.user.id).length,
      onTheRoad: active.filter((c) => c.riderUserId === m.user.id && c.status === "OUT_FOR_DELIVERY").length,
    })),
  };
}

// --- rider accounts ------------------------------------------------------------------

async function accountOf(client: Db, businessId: string, riderUserId: string) {
  const [orders, entries] = await Promise.all([
    client.order.aggregate({
      where: { businessId, riderUserId, deliveryStatus: "DELIVERED" },
      _sum: { cashCollected: true, riderPay: true },
      _count: { _all: true },
    }),
    client.riderEntry.groupBy({ by: ["kind"], where: { businessId, riderUserId }, _sum: { amount: true } }),
  ]);
  const sum = (kind: "CASH_HANDIN" | "PAYOUT") => entries.find((e) => e.kind === kind)?._sum.amount ?? 0;
  const collected = orders._sum.cashCollected ?? 0;
  const earned = orders._sum.riderPay ?? 0;
  const handedIn = sum("CASH_HANDIN");
  const paidOut = sum("PAYOUT");
  return { deliveries: orders._count._all, collected, handedIn, cashOwed: collected - handedIn, earned, paidOut, payDue: earned - paidOut };
}

export async function getRiderAccounts(ctx: TenantContext) {
  needSettle(ctx);
  const riders = await db.membership.findMany({
    where: { businessId: ctx.businessId, role: "RIDER" },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return Promise.all(
    riders.map(async (m) => ({
      userId: m.user.id,
      name: m.user.name,
      deliveryPay: m.deliveryPay,
      ...(await accountOf(db, ctx.businessId, m.user.id)),
      entries: await db.riderEntry.findMany({
        where: { businessId: ctx.businessId, riderUserId: m.user.id },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    })),
  );
}

/** A rider's own numbers, for their page. */
export async function getMyAccount(ctx: TenantContext) {
  if (!can(ctx, "delivery.ride")) throw new DomainError("You do not have permission to make deliveries.");
  return accountOf(db, ctx.businessId, ctx.userId);
}

function cleanAmount(amount: number): number {
  if (!Number.isInteger(amount) || amount < 1 || amount > 100_000_000) throw new DomainError("Enter an amount of Rs 0.01 or more.");
  return amount;
}

async function ownRider(tx: Tx, ctx: TenantContext, riderUserId: string) {
  const m = await tx.membership.findFirst({
    where: { businessId: ctx.businessId, userId: riderUserId, role: "RIDER" },
    include: { user: { select: { name: true } } },
  });
  if (!m) throw new DomainError("Rider not found.");
  return m;
}

/** The rider handed in cash they collected from customers. Cannot be more than they hold. */
export async function recordHandIn(ctx: TenantContext, riderUserId: string, amount: number, note?: string) {
  needSettle(ctx);
  const value = cleanAmount(amount);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const m = await ownRider(tx, ctx, riderUserId);
    // Lock the rider's row so two cashiers recording at once cannot both pass the check.
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE id = ${m.id} FOR UPDATE`;
    const acc = await accountOf(tx, businessId, riderUserId);
    if (value > acc.cashOwed) throw new DomainError(`${m.user.name} only holds ${money(Math.max(0, acc.cashOwed))}.`);
    const e = await tx.riderEntry.create({
      data: { businessId, branchId, riderUserId, kind: "CASH_HANDIN", amount: value, note: note?.trim().slice(0, 200) || null, createdById: ctx.userId },
    });
    await audit(tx, ctx, "rider.handIn", "RiderEntry", e.id, { rider: m.user.name, amount: value });
  });
}

/** The branch paid the rider what they earned. Cannot be more than is due. */
export async function recordPayout(ctx: TenantContext, riderUserId: string, amount: number, note?: string) {
  needSettle(ctx);
  const value = cleanAmount(amount);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const m = await ownRider(tx, ctx, riderUserId);
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE id = ${m.id} FOR UPDATE`;
    const acc = await accountOf(tx, businessId, riderUserId);
    if (value > acc.payDue) throw new DomainError(`${m.user.name} is only owed ${money(Math.max(0, acc.payDue))}.`);
    const e = await tx.riderEntry.create({
      data: { businessId, branchId, riderUserId, kind: "PAYOUT", amount: value, note: note?.trim().slice(0, 200) || null, createdById: ctx.userId },
    });
    await audit(tx, ctx, "rider.payout", "RiderEntry", e.id, { rider: m.user.name, amount: value });
  });
}

/** What a rider is paid per completed delivery. Applies to deliveries from now on; finished ones keep what they earned. */
export async function setRiderPay(ctx: TenantContext, riderUserId: string, paisa: number) {
  if (!can(ctx, "staff.manage")) throw new DomainError("You do not have permission to set rider pay.");
  if (!Number.isInteger(paisa) || paisa < 0 || paisa > 10_000_00) throw new DomainError("Enter a pay between Rs 0 and Rs 10,000 per delivery.");
  await db.$transaction(async (tx) => {
    const m = await ownRider(tx, ctx, riderUserId);
    await tx.membership.update({ where: { id: m.id }, data: { deliveryPay: paisa } });
    await audit(tx, ctx, "rider.setPay", "Membership", m.id, { rider: m.user.name, paisa });
  });
}
