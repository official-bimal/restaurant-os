import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { pushToUser } from "@/features/notifications/server/push";
import { planRoute } from "@/features/delivery/route";

/**
 * Delivery runs: several deliveries one rider takes in a single trip, with the order of the stops planned. A run is made
 * from deliveries that are still being prepared and not already in a run; it can be given a rider, sent out (which sends
 * every delivery in it out at once), or broken up before it leaves. Everything is filtered by business and branch.
 */

const MAX_STOPS = 12;

function need(ctx: TenantContext) {
  if (!can(ctx.role, "order.edit")) throw new DomainError("You do not have permission to plan deliveries.");
}

/** Work out the visiting order for the orders of a run and write it down (stop numbers and the trip's length). */
async function replan(tx: Tx, businessId: string, branchId: string, batchId: string) {
  const [orders, branch, business] = await Promise.all([
    tx.order.findMany({ where: { businessId, batchId }, select: { id: true, destLat: true, destLng: true }, orderBy: { createdAt: "asc" } }),
    tx.branch.findUniqueOrThrow({ where: { businessId_id: { businessId, id: branchId } }, select: { latitude: true, longitude: true } }),
    tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { roadFactorPct: true } }),
  ]);
  const stops = orders.map((o) => ({ id: o.id, point: o.destLat != null && o.destLng != null ? { lat: o.destLat, lng: o.destLng } : null }));
  // The trip starts at the branch; without a location for it, at the first stop that has one.
  const start = branch.latitude != null && branch.longitude != null ? { lat: branch.latitude, lng: branch.longitude } : (stops.find((s) => s.point)?.point ?? null);
  const plan = start ? planRoute(start, stops, business.roadFactorPct) : { order: stops.map((s) => s.id), meters: 0 };
  for (const [i, id] of plan.order.entries()) await tx.order.update({ where: { businessId_id: { businessId, id } }, data: { batchStop: i + 1 } });
  await tx.deliveryBatch.update({ where: { id: batchId }, data: { plannedMeters: plan.meters } });
}

async function riderAccount(tx: Tx, businessId: string, branchId: string, userId: string) {
  const m = await tx.membership.findFirst({
    where: { businessId, userId, role: "RIDER", OR: [{ allBranches: true }, { branches: { some: { branchId } } }] },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!m) throw new DomainError("That rider is not available for this branch.");
  return m.user;
}

/** Group deliveries into one run, optionally giving them to a rider straight away. */
export async function createBatch(ctx: TenantContext, input: { orderIds: string[]; riderUserId?: string }) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const ids = [...new Set(input.orderIds)];
  if (ids.length < 2) throw new DomainError("Choose at least two deliveries to put in one run.");
  if (ids.length > MAX_STOPS) throw new DomainError(`A run can have at most ${MAX_STOPS} deliveries.`);

  const batch = await db.$transaction(async (tx) => {
    const orders = await tx.order.findMany({ where: { id: { in: ids }, businessId, branchId, type: "DELIVERY" } });
    if (orders.length !== ids.length) throw new DomainError("One of those deliveries was not found.");
    for (const o of orders) {
      if (o.status === "CANCELLED" || o.status === "MERGED") throw new DomainError(`Order #${o.number} was cancelled.`);
      if (o.deliveryStatus !== "PREPARING") throw new DomainError(`Order #${o.number} has already left.`);
      if (o.batchId) throw new DomainError(`Order #${o.number} is already in a run.`);
    }
    const rider = input.riderUserId ? await riderAccount(tx, businessId, branchId, input.riderUserId) : null;
    // A rider already holding different deliveries is fine, but two runs cannot be sent out for the same rider at once.
    const b = await tx.deliveryBatch.create({
      data: { businessId, branchId, createdById: ctx.userId, riderUserId: rider?.id ?? null, riderName: rider?.name ?? null },
    });
    // Claim each order for the run: if someone else grabbed one a moment ago, the claim fails and nothing is made.
    for (const o of orders) {
      const claimed = await tx.order.updateMany({
        where: { id: o.id, businessId, batchId: null, deliveryStatus: "PREPARING" },
        data: { batchId: b.id, ...(rider ? { riderUserId: rider.id, riderName: rider.name } : {}) },
      });
      if (claimed.count === 0) throw new DomainError(`Order #${o.number} was just taken by another run.`);
    }
    await replan(tx, businessId, branchId, b.id);
    await audit(tx, ctx, "batch.create", "DeliveryBatch", b.id, { orders: orders.length, rider: rider?.name ?? null });
    return { id: b.id, riderId: rider?.id ?? null, count: orders.length };
  });
  if (batch.riderId) {
    void pushToUser({ businessId, userId: batch.riderId, payload: { title: "New delivery run for you", body: `${batch.count} deliveries are being prepared.`, url: "/deliveries", tag: `batch-${batch.id}` } });
  }
  return batch;
}

/** Give a run that has not left yet to a rider (or to a different one). */
export async function assignBatchRider(ctx: TenantContext, batchId: string, riderUserId: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const rider = await db.$transaction(async (tx) => {
    const b = await tx.deliveryBatch.findFirst({ where: { id: batchId, businessId, branchId } });
    if (!b) throw new DomainError("Run not found.");
    if (b.status !== "PLANNED") throw new DomainError("This run has already left.");
    const r = await riderAccount(tx, businessId, branchId, riderUserId);
    await tx.deliveryBatch.update({ where: { id: batchId }, data: { riderUserId: r.id, riderName: r.name } });
    await tx.order.updateMany({ where: { businessId, batchId, deliveryStatus: "PREPARING" }, data: { riderUserId: r.id, riderName: r.name } });
    await audit(tx, ctx, "batch.assign", "DeliveryBatch", batchId, { rider: r.name });
    return r;
  });
  void pushToUser({ businessId, userId: rider.id, payload: { title: "New delivery run for you", body: "Open your deliveries to see the stops in order.", url: "/deliveries", tag: `batch-${batchId}` } });
}

/** Send the whole run out: every delivery in it goes out together. Needs a rider. */
export async function startBatch(ctx: TenantContext, batchId: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const b = await tx.deliveryBatch.findFirst({ where: { id: batchId, businessId, branchId } });
    if (!b) throw new DomainError("Run not found.");
    if (b.status !== "PLANNED") throw new DomainError("This run has already left.");
    if (!b.riderUserId && !b.riderName) throw new DomainError("Give the run to a rider first.");
    // Deliveries cancelled while the run was being put together simply drop out of it.
    await tx.order.updateMany({ where: { businessId, batchId, OR: [{ status: { in: ["CANCELLED", "MERGED"] } }, { deliveryStatus: { not: "PREPARING" } }] }, data: { batchId: null, batchStop: null } });
    const sent = await tx.order.updateMany({
      where: { businessId, batchId, deliveryStatus: "PREPARING" },
      data: { deliveryStatus: "OUT_FOR_DELIVERY", ...(b.riderName ? { riderName: b.riderName } : {}), ...(b.riderUserId ? { riderUserId: b.riderUserId } : {}) },
    });
    if (sent.count === 0) {
      await tx.deliveryBatch.delete({ where: { id: batchId } });
      throw new DomainError("Every delivery in this run was cancelled, so the run was removed.");
    }
    await tx.deliveryBatch.update({ where: { id: batchId }, data: { status: "OUT", startedAt: new Date() } });
    await replan(tx, businessId, branchId, batchId);
    await audit(tx, ctx, "batch.start", "DeliveryBatch", batchId, { orders: sent.count });
  });
}

/** Take one delivery out of a run that has not left yet. A run with fewer than two deliveries left is broken up. */
export async function removeFromBatch(ctx: TenantContext, orderId: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const o = await tx.order.findFirst({ where: { id: orderId, businessId, branchId, batchId: { not: null } }, include: { batch: true } });
    if (!o || !o.batch) throw new DomainError("That delivery is not in a run.");
    if (o.batch.status !== "PLANNED") throw new DomainError("This run has already left.");
    await tx.order.update({ where: { businessId_id: { businessId, id: orderId } }, data: { batchId: null, batchStop: null } });
    const left = await tx.order.count({ where: { businessId, batchId: o.batchId } });
    if (left < 2) {
      await tx.order.updateMany({ where: { businessId, batchId: o.batchId }, data: { batchId: null, batchStop: null } });
      await tx.deliveryBatch.delete({ where: { id: o.batchId! } });
    } else {
      await replan(tx, businessId, branchId, o.batchId!);
    }
    await audit(tx, ctx, "batch.remove", "Order", orderId, { batchId: o.batchId });
  });
}

/** Break up a run that has not left yet. The deliveries stay, ungrouped. */
export async function cancelBatch(ctx: TenantContext, batchId: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const b = await tx.deliveryBatch.findFirst({ where: { id: batchId, businessId, branchId } });
    if (!b) throw new DomainError("Run not found.");
    if (b.status !== "PLANNED") throw new DomainError("This run has already left.");
    await tx.order.updateMany({ where: { businessId, batchId }, data: { batchId: null, batchStop: null } });
    await tx.deliveryBatch.delete({ where: { id: batchId } });
    await audit(tx, ctx, "batch.cancel", "DeliveryBatch", batchId);
  });
}

/** Runs that are not finished in this branch, each with its stops in visiting order. */
export async function listBatches(ctx: TenantContext) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const batches = await db.deliveryBatch.findMany({
    where: { businessId, branchId, status: { in: ["PLANNED", "OUT"] } },
    include: {
      orders: {
        orderBy: { batchStop: "asc" },
        select: { id: true, number: true, deliveryName: true, deliveryAddress: true, deliveryStatus: true, batchStop: true, deliveryZoneName: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return batches;
}
