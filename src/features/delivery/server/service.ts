import { publishLiveSoon } from "@/server/live";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { settleBatchIfDone } from "./batch-state";
import { Prisma } from "@/generated/prisma/client";
import { calculateBill } from "@/features/billing/calc";
import { canMoveDelivery } from "@/features/orders/server/delivery";

/**
 * Delivery zones (per branch), the customer's tracking page and the rider's page.
 * Zones are filtered by business and branch. The two public pages are reached only by an
 * unguessable per-order token and reveal as little as they need to.
 */

function need(ctx: TenantContext) {
  if (!can(ctx.role, "floor.manage")) throw new DomainError("You do not have permission to change delivery zones.");
}

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 60) throw new DomainError("Zone name must be 1 to 60 characters.");
  return name;
}

function cleanFee(fee: number): number {
  if (!Number.isInteger(fee) || fee < 0 || fee > 10_000_00) throw new DomainError("Enter a fee between Rs 0 and Rs 10,000.");
  return fee;
}

async function unique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DomainError("A zone with that name already exists in this branch.");
    }
    throw e;
  }
}

/** The zones a waiter can pick from when taking a delivery order in the current branch. */
export async function activeZones(ctx: TenantContext) {
  return db.deliveryZone.findMany({ where: { ...scope(ctx), active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, fee: true } });
}

export async function listZones(ctx: TenantContext) {
  need(ctx);
  return db.deliveryZone.findMany({ where: scope(ctx), orderBy: [{ active: "desc" }, { name: "asc" }] });
}

export async function createZone(ctx: TenantContext, input: { name: string; fee: number }) {
  need(ctx);
  const name = cleanName(input.name);
  const fee = cleanFee(input.fee);
  return unique(() =>
    db.$transaction(async (tx) => {
      const z = await tx.deliveryZone.create({ data: { ...scope(ctx), name, fee } });
      await audit(tx, ctx, "zone.create", "DeliveryZone", z.id, { name, fee });
      return z;
    }),
  );
}

export async function updateZone(ctx: TenantContext, id: string, input: { name: string; fee: number }) {
  need(ctx);
  const name = cleanName(input.name);
  const fee = cleanFee(input.fee);
  await unique(() =>
    db.$transaction(async (tx) => {
      const r = await tx.deliveryZone.updateMany({ where: { id, ...scope(ctx) }, data: { name, fee } });
      if (r.count === 0) throw new DomainError("Zone not found.");
      await audit(tx, ctx, "zone.update", "DeliveryZone", id, { name, fee });
    }),
  );
}

export async function setZoneActive(ctx: TenantContext, id: string, active: boolean) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const r = await tx.deliveryZone.updateMany({ where: { id, ...scope(ctx) }, data: { active } });
    if (r.count === 0) throw new DomainError("Zone not found.");
    await audit(tx, ctx, active ? "zone.activate" : "zone.deactivate", "DeliveryZone", id);
  });
}

// --- customer tracking page ------------------------------------------------------

const TRACK_STEPS = ["PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"] as const;

/**
 * What a customer may see about their delivery. Deliberately not the phone number, the address,
 * prices or the rider's surname: anyone holding the link sees this page.
 */
export async function getTracking(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const order = await db.order.findUnique({
    where: { trackingToken: token },
    include: {
      business: { select: { name: true } },
      branch: { select: { name: true, latitude: true, longitude: true } },
      items: { where: { status: { not: "CANCELLED" } }, select: { name: true, quantity: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order || order.type !== "DELIVERY" || !order.deliveryStatus) return null;
  const cancelled = order.status === "CANCELLED" || order.status === "MERGED";
  return {
    businessName: order.business.name,
    number: order.number,
    createdAt: order.createdAt,
    status: cancelled ? ("CANCELLED" as const) : order.deliveryStatus,
    riderFirstName: order.riderName ? order.riderName.split(" ")[0]! : null,
    location: locationView(order),
    map: mapPoints(order),
    items: order.items,
    steps: TRACK_STEPS,
  };
}

// --- rider page ------------------------------------------------------------------

/** What the customer owes right now for an unpaid delivery (no discount; the rider collects the plain bill). */
function billTotal(order: {
  items: { unitPrice: number; quantity: number; complimentary: boolean }[];
  deliveryFee: number;
  business: { serviceChargeBps: number; vatMode: "EXCLUSIVE" | "INCLUSIVE" | "NONE"; vatBps: number; vatAppliesToServiceCharge: boolean; roundToRupee: boolean; vatOnDeliveryFee: boolean };
}) {
  const b = order.business;
  return calculateBill(
    order.items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, complimentary: i.complimentary })),
    {
      discount: { kind: "none" },
      serviceChargeBps: b.serviceChargeBps,
      vatMode: b.vatMode,
      vatBps: b.vatBps,
      vatAppliesToServiceCharge: b.vatAppliesToServiceCharge,
      roundToRupee: b.roundToRupee,
      deliveryFee: order.deliveryFee,
      vatOnDeliveryFee: b.vatOnDeliveryFee,
    },
  ).grandTotal;
}

export type RiderAction = "PICKED_UP" | "DELIVERED" | "FAILED";

/** The rider's job: where to go, who to call, and how much to collect if it is not paid yet. */
export async function getRiderJob(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const order = await db.order.findUnique({
    where: { riderToken: token },
    include: {
      business: true,
      items: { where: { status: { not: "CANCELLED" } }, include: { addOns: true }, orderBy: { createdAt: "asc" } },
      invoice: { select: { grandTotal: true } },
    },
  });
  if (!order || order.type !== "DELIVERY" || !order.deliveryStatus) return null;
  const cancelled = order.status === "CANCELLED" || order.status === "MERGED";

  // Cash to collect: the bill as it stands now, unless it is already paid.
  const collect = !cancelled && order.status !== "PAID" ? billTotal(order) : 0;
  return {
    businessName: order.business.name,
    number: order.number,
    status: cancelled ? ("CANCELLED" as const) : order.deliveryStatus,
    customerName: order.deliveryName,
    phone: order.deliveryPhone,
    address: order.deliveryAddress,
    zone: order.deliveryZoneName,
    items: order.items.map((i) => ({ name: i.name, quantity: i.quantity, addOns: i.addOns.map((a) => a.name) })),
    paid: order.status === "PAID",
    collect,
    note: order.note,
  };
}

/**
 * What to record when a delivery ends. The rider's position is wiped. A delivered order also keeps the cash the rider
 * collected (the bill if it was still unpaid) and the pay they earned for it, copied now so later changes to the bill or
 * to their rate do not rewrite history. A failed delivery earns nothing.
 */
export async function finishData(
  tx: Tx,
  order: { id: string; businessId: string; riderUserId: string | null; status: string },
  to: "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED",
) {
  if (to === "OUT_FOR_DELIVERY") return {};
  const base = { riderLat: null, riderLng: null, riderLocationAt: null, deliveredAt: new Date() };
  if (to === "FAILED") return base;

  let cashCollected = 0;
  if (order.status !== "PAID") {
    const full = await tx.order.findFirstOrThrow({
      where: { id: order.id, businessId: order.businessId },
      include: { business: true, items: { where: { status: { not: "CANCELLED" } } } },
    });
    cashCollected = billTotal(full);
  }
  let riderPay = 0;
  if (order.riderUserId) {
    const m = await tx.membership.findFirst({ where: { businessId: order.businessId, userId: order.riderUserId }, select: { deliveryPay: true } });
    riderPay = m?.deliveryPay ?? 0;
  }
  return { ...base, cashCollected, riderPay };
}

/**
 * Move a delivery forward on the rider's say-so, either through the link (no user) or from their own account.
 * Only forward steps; a finished job cannot be changed. Compare-and-set, so two quick taps (or the cashier at the
 * same moment) cannot both apply. The rider's location is wiped when the job ends.
 */
async function moveByRider(where: Prisma.OrderWhereInput, action: RiderAction, userId: string | null) {
  const to = action === "PICKED_UP" ? "OUT_FOR_DELIVERY" : action;
  await db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where });
    if (!order || !order.deliveryStatus || order.type !== "DELIVERY") throw new DomainError("This delivery link is not valid.");
    if (order.status === "CANCELLED" || order.status === "MERGED") throw new DomainError("This order was cancelled.");
    if (!canMoveDelivery(order.deliveryStatus, to)) throw new DomainError("That step is not available any more.");
    const r = await tx.order.updateMany({
      where: { id: order.id, businessId: order.businessId, deliveryStatus: order.deliveryStatus },
      data: {
        deliveryStatus: to,
        ...(to === "OUT_FOR_DELIVERY" && !order.riderName ? { riderName: "Rider" } : {}),
        ...(await finishData(tx, order, to)),
      },
    });
    if (r.count === 0) throw new DomainError("That step is not available any more.");
    if (to !== "OUT_FOR_DELIVERY") await settleBatchIfDone(tx, order.businessId, order.batchId);
    await tx.auditEvent.create({
      data: { businessId: order.businessId, userId, action: "order.deliveryByRider", entity: "Order", entityId: order.id, detail: { from: order.deliveryStatus, to } },
    });
    publishLiveSoon({ businessId: order.businessId, branchId: order.branchId, topic: "delivery" });
  });
}

export async function riderUpdate(token: string, action: RiderAction) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new DomainError("This delivery link is not valid.");
  await moveByRider({ riderToken: token }, action, null);
}

// --- rider accounts: their own list of deliveries ---------------------------------

function needRide(ctx: TenantContext) {
  if (!can(ctx.role, "delivery.ride")) throw new DomainError("You do not have permission to make deliveries.");
}

/** Rider accounts a cashier can choose when sending a delivery out from the current branch. */
export async function listRiders(ctx: TenantContext) {
  const rows = await db.membership.findMany({
    where: {
      businessId: ctx.businessId,
      role: "RIDER",
      OR: [{ allBranches: true }, { branches: { some: { branchId: ctx.branchId } } }],
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({ userId: m.user.id, name: m.user.name }));
}

/** The deliveries assigned to this rider that are still to do, oldest first. Only theirs, in their branches. */
export async function listMyDeliveries(ctx: TenantContext) {
  needRide(ctx);
  const orders = await db.order.findMany({
    where: {
      businessId: ctx.businessId,
      branchId: { in: ctx.branchIds },
      type: "DELIVERY",
      riderUserId: ctx.userId,
      deliveryStatus: { in: ["PREPARING", "OUT_FOR_DELIVERY"] },
      status: { notIn: ["CANCELLED", "MERGED"] },
    },
    include: {
      business: true,
      items: { where: { status: { not: "CANCELLED" } }, include: { addOns: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  const perRun = new Map<string, number>();
  for (const o of orders) if (o.batchId) perRun.set(o.batchId, (perRun.get(o.batchId) ?? 0) + 1);
  const firstSeen = new Map<string, number>();
  orders.forEach((o, i) => o.batchId && !firstSeen.has(o.batchId) && firstSeen.set(o.batchId, i));
  // A run's stops stay together, in the planned order; single deliveries keep their place.
  const sorted = [...orders].sort((a, b) => {
    const ka = a.batchId ? firstSeen.get(a.batchId)! : orders.indexOf(a);
    const kb = b.batchId ? firstSeen.get(b.batchId)! : orders.indexOf(b);
    return ka - kb || (a.batchStop ?? 0) - (b.batchStop ?? 0);
  });
  return sorted.map((o) => ({
    id: o.id,
    number: o.number,
    run: o.batchId && o.batchStop ? { stop: o.batchStop, of: perRun.get(o.batchId) ?? 1 } : null,
    status: o.deliveryStatus!,
    customerName: o.deliveryName,
    phone: o.deliveryPhone,
    address: o.deliveryAddress,
    zone: o.deliveryZoneName,
    items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, addOns: i.addOns.map((a) => a.name) })),
    paid: o.status === "PAID",
    collect: o.status === "PAID" ? 0 : billTotal(o),
  }));
}

export async function riderUpdateAsUser(ctx: TenantContext, orderId: string, action: RiderAction) {
  needRide(ctx);
  await moveByRider(
    { id: orderId, businessId: ctx.businessId, branchId: { in: ctx.branchIds }, riderUserId: ctx.userId },
    action,
    ctx.userId,
  );
}

// --- live location -----------------------------------------------------------------

const MIN_GAP_MS = 5_000;

function checkCoords(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new DomainError("That location is not valid.");
  }
}

async function saveLocation(where: Prisma.OrderWhereInput, lat: number, lng: number) {
  checkCoords(lat, lng);
  const order = await db.order.findFirst({ where });
  // Only while the delivery is out: before pickup and after delivery nothing is kept.
  if (!order || order.deliveryStatus !== "OUT_FOR_DELIVERY") throw new DomainError("Location sharing is only on while a delivery is out.");
  if (order.riderLocationAt && Date.now() - order.riderLocationAt.getTime() < MIN_GAP_MS) return;
  await db.order.updateMany({
    where: { id: order.id, businessId: order.businessId, deliveryStatus: "OUT_FOR_DELIVERY" },
    data: { riderLat: lat, riderLng: lng, riderLocationAt: new Date() },
  });
}

export async function reportLocationAsUser(ctx: TenantContext, orderId: string, lat: number, lng: number) {
  needRide(ctx);
  await saveLocation({ id: orderId, businessId: ctx.businessId, riderUserId: ctx.userId, branchId: { in: ctx.branchIds } }, lat, lng);
}

export async function reportLocationByToken(token: string, lat: number, lng: number) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new DomainError("This delivery link is not valid.");
  await saveLocation({ riderToken: token }, lat, lng);
}

/** The points for the in-app map: the branch, the delivery address, and the rider while the delivery is out. */
export function mapPoints(o: {
  branch?: { latitude: number | null; longitude: number | null } | null;
  destLat: number | null;
  destLng: number | null;
  riderLat: number | null;
  riderLng: number | null;
  riderLocationAt: Date | null;
  deliveryStatus: string | null;
}) {
  const branch = o.branch && o.branch.latitude != null && o.branch.longitude != null ? { lat: o.branch.latitude, lng: o.branch.longitude } : null;
  const destination = o.destLat != null && o.destLng != null ? { lat: o.destLat, lng: o.destLng } : null;
  const live = locationView(o);
  const rider = live && o.riderLat != null && o.riderLng != null ? { lat: o.riderLat, lng: o.riderLng } : null;
  return { branch, destination, rider, riderAgeMinutes: live?.ageMinutes ?? null };
}

/** A map link for a recent rider position (opened in the person's own maps app or browser), or null. */
export function locationView(o: { riderLat: number | null; riderLng: number | null; riderLocationAt: Date | null; deliveryStatus: string | null }) {
  if (o.deliveryStatus !== "OUT_FOR_DELIVERY" || o.riderLat === null || o.riderLng === null || !o.riderLocationAt) return null;
  const ageMinutes = Math.floor((Date.now() - o.riderLocationAt.getTime()) / 60_000);
  if (ageMinutes > 30) return null;
  return { ageMinutes, url: `https://www.openstreetmap.org/?mlat=${o.riderLat}&mlon=${o.riderLng}#map=16/${o.riderLat}/${o.riderLng}` };
}

// --- distance bands and VAT on the fee ----------------------------------------------

function cleanMeters(km: number): number {
  const meters = Math.round(km * 1000);
  if (!Number.isFinite(meters) || meters < 100 || meters > 200_000) throw new DomainError("Enter a distance between 0.1 km and 200 km.");
  return meters;
}

export async function activeBands(ctx: TenantContext) {
  return db.deliveryBand.findMany({ where: { ...scope(ctx), active: true }, orderBy: { upToMeters: "asc" }, select: { id: true, upToMeters: true, fee: true } });
}

export async function listBands(ctx: TenantContext) {
  need(ctx);
  return db.deliveryBand.findMany({ where: scope(ctx), orderBy: [{ active: "desc" }, { upToMeters: "asc" }] });
}

async function uniqueBand<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DomainError("This branch already has a band for that distance.");
    }
    throw e;
  }
}

export async function createBand(ctx: TenantContext, input: { upToKm: number; fee: number }) {
  need(ctx);
  const upToMeters = cleanMeters(input.upToKm);
  const fee = cleanFee(input.fee);
  return uniqueBand(() =>
    db.$transaction(async (tx) => {
      const b = await tx.deliveryBand.create({ data: { ...scope(ctx), upToMeters, fee } });
      await audit(tx, ctx, "band.create", "DeliveryBand", b.id, { upToMeters, fee });
      return b;
    }),
  );
}

export async function updateBand(ctx: TenantContext, id: string, input: { upToKm: number; fee: number }) {
  need(ctx);
  const upToMeters = cleanMeters(input.upToKm);
  const fee = cleanFee(input.fee);
  await uniqueBand(() =>
    db.$transaction(async (tx) => {
      const r = await tx.deliveryBand.updateMany({ where: { id, ...scope(ctx) }, data: { upToMeters, fee } });
      if (r.count === 0) throw new DomainError("Band not found.");
      await audit(tx, ctx, "band.update", "DeliveryBand", id, { upToMeters, fee });
    }),
  );
}

export async function setBandActive(ctx: TenantContext, id: string, active: boolean) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const r = await tx.deliveryBand.updateMany({ where: { id, ...scope(ctx) }, data: { active } });
    if (r.count === 0) throw new DomainError("Band not found.");
    await audit(tx, ctx, active ? "band.activate" : "band.deactivate", "DeliveryBand", id);
  });
}

/** Whether VAT is charged on the delivery fee (business-wide). */
export async function setVatOnDeliveryFee(ctx: TenantContext, value: boolean) {
  need(ctx);
  await db.$transaction(async (tx) => {
    await tx.business.update({ where: { id: ctx.businessId }, data: { vatOnDeliveryFee: value } });
    await audit(tx, ctx, "delivery.vatOnFee", "Business", ctx.businessId, { value });
  });
}

export async function getDeliverySettings(ctx: TenantContext) {
  return db.business.findUniqueOrThrow({
    where: { id: ctx.businessId },
    select: { vatOnDeliveryFee: true, vatMode: true, vatBps: true, roadFactorPct: true },
  });
}

/** How much longer than a straight line a road trip usually is, as a percentage (130 = 30% longer). */
export async function setRoadFactor(ctx: TenantContext, pct: number) {
  need(ctx);
  if (!Number.isInteger(pct) || pct < 100 || pct > 300) throw new DomainError("Enter a percentage between 100 and 300.");
  await db.$transaction(async (tx) => {
    await tx.business.update({ where: { id: ctx.businessId }, data: { roadFactorPct: pct } });
    await audit(tx, ctx, "delivery.roadFactor", "Business", ctx.businessId, { pct });
  });
}
