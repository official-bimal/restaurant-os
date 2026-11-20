import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { scope } from "@/server/branch";
import { Prisma } from "@/generated/prisma/client";
import { publishLive } from "@/server/live";
import { normalizePhone } from "@/server/phone";
import { calculateBill } from "@/features/billing/calc";
import { syncOrderStatus } from "@/features/orders/server/sync";
import { upsertCustomer } from "@/features/loyalty/server/customers";
import { autoQueueKitchenSlip } from "@/features/printing/server/queue";
import { orderableItemIds } from "@/features/menu/server/menu-sets";
import { addOnNames, groupRulesForMenu, priceAddOns } from "@/features/menu/server/pricing";
import { pushToTeam } from "@/features/notifications/server/push";
import { branchMenuOverrides, effectiveItem, hiddenDishIds } from "@/features/menu/server/branch-menu";
import { locateDestination, quoteDeliveryFee, rememberPlace, type Located } from "@/features/delivery/server/fee";
import { LIMITS, cleanText, isOnlineType, isStale, isToken, prepMessage, statusText, type OnlineType } from "../rules";

/**
 * Online ordering: customers order takeaway or delivery from a public page and pay at pickup or at the door.
 *
 * Trust model: the branch's secret link token only lets someone see the menu and send an order. An order is only a REQUEST
 * (OnlineOrder) until staff accept it; accepting turns it into a real Order in one transaction. Prices, choices and the delivery fee
 * are worked out here, never taken from the customer's phone. Nobody is signed in, so abuse is limited by the number of requests a
 * phone and a branch may have waiting, and by a rate limit on the public actions. The customer's phone number becomes a Customer
 * only when staff accept, so spam never fills the customer list.
 */

type Db = Tx | typeof db;

export const newToken = () => randomBytes(18).toString("base64url");

// ---------- what the branch sells online ----------

/** Dishes this branch may sell online right now, with the branch's own prices. Same rules as the guest QR menu, but for a branch. */
async function branchRules(client: Db, businessId: string, branchId: string) {
  const [orderable, overrides, hidden] = await Promise.all([
    orderableItemIds(client, businessId, branchId),
    branchMenuOverrides(client, businessId, branchId),
    hiddenDishIds(client, businessId, branchId),
  ]);
  const allowed = (id: string) => (!orderable || orderable.has(id)) && (overrides.get(id)?.available ?? true) && !hidden.has(id);
  const priceOf = (id: string, shared: number) => effectiveItem({ price: shared, available: true }, overrides.get(id)).price;
  return { allowed, priceOf };
}

export interface PublicBranch {
  branchId: string;
  businessId: string;
  businessName: string;
  branchName: string;
  enabled: boolean;
  pickup: boolean;
  delivery: boolean;
  minOrder: number;
  prepMinutes: number;
  notice: string | null;
  /** Delivery areas to choose from. Empty when the branch prices delivery by distance (or has no fee). */
  zones: { id: string; name: string; fee: number }[];
  /** True when the fee depends on the distance (the customer gives a location or the staff set it). */
  byDistance: boolean;
}

/** Public lookup by the secret link token. Returns only what the public page may show. */
export async function lookupBranch(token: string): Promise<PublicBranch | null> {
  if (!isToken(token)) return null;
  const branch = await db.branch.findUnique({ where: { onlineToken: token }, include: { business: { select: { name: true } } } });
  if (!branch || !branch.active) return null;
  const [bands, zones] = await Promise.all([
    db.deliveryBand.count({ where: { businessId: branch.businessId, branchId: branch.id, active: true } }),
    db.deliveryZone.findMany({ where: { businessId: branch.businessId, branchId: branch.id, active: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    branchId: branch.id,
    businessId: branch.businessId,
    businessName: branch.business.name,
    branchName: branch.name,
    enabled: branch.onlineEnabled,
    pickup: branch.onlinePickup,
    delivery: branch.onlineDelivery,
    minOrder: branch.onlineMinOrder,
    prepMinutes: branch.onlinePrepMinutes,
    notice: branch.onlineNotice,
    zones: bands > 0 ? [] : zones.map((z) => ({ id: z.id, name: z.name, fee: z.fee })),
    byDistance: bands > 0,
  };
}

export async function getOnlineMenu(b: Pick<PublicBranch, "businessId" | "branchId">) {
  const [categories, rules, groups] = await Promise.all([
    db.menuCategory.findMany({
      where: { businessId: b.businessId },
      include: { items: { where: { available: true }, orderBy: { name: "asc" }, include: { image: { select: { updatedAt: true } } } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    branchRules(db, b.businessId, b.branchId),
    groupRulesForMenu(db, b.businessId, b.branchId),
  ]);
  return categories
    .map((c) => ({
      id: c.id,
      name: c.name,
      nameNe: c.nameNe,
      items: c.items
        .filter((i) => rules.allowed(i.id))
        .map((i) => ({ id: i.id, name: i.name, nameNe: i.nameNe, price: rules.priceOf(i.id, i.price), groups: groups.get(i.id) ?? [], photo: i.image ? i.image.updatedAt.getTime() : null })),
    }))
    .filter((c) => c.items.length > 0);
}

// ---------- the customer sends an order ----------

export interface OnlineOrderInput {
  idempotencyKey: string;
  type: OnlineType;
  name: string;
  phone: string;
  note?: string;
  address?: string;
  /** Coordinates or a map link the customer pasted (optional). */
  location?: string;
  zoneId?: string;
  items: { menuItemId: string; quantity: number; note?: string; addOnIds?: string[] }[];
}

async function openBranch(token: string): Promise<PublicBranch> {
  const b = await lookupBranch(token);
  if (!b) throw new DomainError("This ordering link is not valid any more. Please ask the restaurant for the current one.");
  if (!b.enabled) throw new DomainError("Online ordering is not available right now.");
  return b;
}

/** What delivery to this address would cost, for the page to show before the customer sends the order. */
export async function quoteDelivery(token: string, input: { address: string; phone?: string; location?: string; zoneId?: string }) {
  const b = await openBranch(token);
  if (!b.delivery) throw new DomainError("This branch does not deliver.");
  const address = cleanText(input.address, LIMITS.addressLength);
  if (address.length < 5 && !input.location?.trim() && b.byDistance) throw new DomainError("Enter your address.");
  const located = b.byDistance ? await locateDestination({ businessId: b.businessId, branchId: b.branchId, address, phone: input.phone ?? "", location: input.location }) : null;
  if (b.byDistance && !located) throw new DomainError("We could not find that address. Paste your location (coordinates or a map link) so we can work out the delivery fee.");
  if (b.byDistance && located?.meters == null) throw new DomainError("Delivery cannot be priced online for this branch yet. Please call the restaurant.");
  const quote = await quoteDeliveryFee(db, { businessId: b.businessId, branchId: b.branchId, located, zoneId: input.zoneId });
  return { fee: quote?.fee ?? 0, label: quote?.name ?? "Delivery" };
}

export async function submitOnlineOrder(token: string, input: OnlineOrderInput) {
  const b = await openBranch(token);
  const { businessId, branchId } = b;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.idempotencyKey)) throw new DomainError("Something went wrong. Please try again.");
  if (!isOnlineType(input.type)) throw new DomainError("Choose pickup or delivery.");
  if (input.type === "TAKEAWAY" && !b.pickup) throw new DomainError("Pickup is not available at this branch.");
  if (input.type === "DELIVERY" && !b.delivery) throw new DomainError("Delivery is not available at this branch.");

  const name = cleanText(input.name, LIMITS.nameLength);
  if (name.length < 2) throw new DomainError("Enter your name.");
  const phone = normalizePhone(input.phone);
  const note = cleanText(input.note, LIMITS.noteLength) || null;
  const address = input.type === "DELIVERY" ? cleanText(input.address, LIMITS.addressLength) : "";
  if (input.type === "DELIVERY" && address.length < 5) throw new DomainError("Enter your delivery address.");

  // The same key again (double tap, retry after a bad connection) returns the first order.
  const existing = await db.onlineOrder.findUnique({ where: { businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey } } });
  if (existing) {
    if (existing.customerPhone !== phone || existing.branchId !== branchId) throw new DomainError("Something went wrong. Please try again.");
    return summary(existing);
  }

  if (input.items.length === 0) throw new DomainError("Your cart is empty.");
  if (input.items.length > LIMITS.linesPerOrder) throw new DomainError("That is a lot of dishes. Please split it into two orders.");
  for (const i of input.items) {
    if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > LIMITS.quantityPerLine) throw new DomainError(`Choose between 1 and ${LIMITS.quantityPerLine} of each dish.`);
  }

  // Delivery: where it goes and what it costs, worked out here. A network lookup, so before the transaction.
  let located: Located | null = null;
  let fee = { fee: 0, name: null as string | null, meters: null as number | null, zoneId: null as string | null };
  if (input.type === "DELIVERY") {
    located = await locateDestination({ businessId, branchId, address, phone, location: input.location });
    const quote = await quoteDeliveryFee(db, { businessId, branchId, located, zoneId: input.zoneId });
    fee = { fee: quote?.fee ?? 0, name: quote?.name ?? null, meters: quote?.meters ?? null, zoneId: b.zones.some((z) => z.id === input.zoneId) ? (input.zoneId ?? null) : null };
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const waitingHere = await tx.onlineOrder.count({ where: { businessId, branchId, status: "PENDING" } });
      const mine = await tx.onlineOrder.count({ where: { businessId, customerPhone: phone, status: "PENDING" } });
      if (mine >= LIMITS.pendingPerPhone) throw new DomainError("You already have an order waiting for the restaurant. Please wait for it to be accepted, or cancel it first.");
      if (waitingHere >= LIMITS.pendingPerBranch) throw new DomainError("The restaurant has a lot of orders waiting right now. Please try again in a few minutes or call us.");

      const ids = [...new Set(input.items.map((i) => i.menuItemId))];
      const menu = await tx.menuItem.findMany({ where: { businessId, id: { in: ids }, available: true } });
      const byId = new Map(menu.map((m) => [m.id, m]));
      const rules = await branchRules(tx, businessId, branchId);
      if (ids.some((id) => !byId.has(id) || !rules.allowed(id))) throw new DomainError("Some dishes are no longer available. Please refresh the menu.");

      const rows = [];
      let subtotal = 0;
      for (const i of input.items) {
        const m = byId.get(i.menuItemId)!;
        // The choices are checked against what the dish offers, and priced here, never from the phone.
        const { chosen, extra } = await priceAddOns(tx, businessId, m.id, i.addOnIds ?? [], branchId);
        const unitPrice = rules.priceOf(m.id, m.price) + extra;
        subtotal += unitPrice * i.quantity;
        rows.push({ businessId, menuItemId: m.id, name: m.name, unitPrice, quantity: i.quantity, note: cleanText(i.note, LIMITS.noteLength) || null, addOnIds: chosen.map((c) => c.id) });
      }
      if (subtotal < b.minOrder) throw new DomainError(`The minimum order is Rs ${(b.minOrder / 100).toLocaleString("en-US")}.`);

      const order = await tx.onlineOrder.create({
        data: {
          businessId,
          branchId,
          type: input.type,
          customerName: name,
          customerPhone: phone,
          note,
          subtotal,
          idempotencyKey: input.idempotencyKey,
          trackingToken: newToken(),
          ...(input.type === "DELIVERY"
            ? { address, location: cleanText(input.location, 120) || null, destLat: located?.dest.lat ?? null, destLng: located?.dest.lng ?? null, deliveryFee: fee.fee, deliveryZoneId: fee.zoneId, deliveryZoneName: fee.name, deliveryMeters: fee.meters }
            : {}),
        },
      });
      await tx.onlineOrderItem.createMany({ data: rows.map((r) => ({ ...r, onlineOrderId: order.id })) });
      return order;
    });
    alertStaff(businessId, branchId, `${input.type === "DELIVERY" ? "Delivery" : "Pickup"} order from ${name}`);
    return summary(created);
  } catch (e) {
    // Two identical taps raced: the loser returns the winner's order.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.onlineOrder.findUnique({ where: { businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey } } });
      if (again && again.customerPhone === phone) return summary(again);
    }
    throw e;
  }
}

const summary = (o: { id: string; status: string; trackingToken: string; subtotal: number; deliveryFee: number }) => ({ id: o.id, status: o.status, trackingToken: o.trackingToken, subtotal: o.subtotal, deliveryFee: o.deliveryFee });

/** Tell the staff of the branch, even if their app is closed. Never blocks or fails the customer. */
function alertStaff(businessId: string, branchId: string, text: string): void {
  try {
    publishLive({ businessId, branchId, topic: "online" });
    void pushToTeam({ businessId, branchId, permission: "order.edit", payload: { title: "New online order", body: `${text}. Open Online orders to accept it.`, url: "/online", tag: "online-order" } });
  } catch {
    // an alert that fails must not fail the customer's order
  }
}

// ---------- the customer follows their order ----------

export async function getOnlineStatus(token: string, trackingToken: string) {
  if (!isToken(token) || !isToken(trackingToken)) return null;
  const branch = await db.branch.findUnique({ where: { onlineToken: token }, include: { business: true } });
  if (!branch) return null;
  const o = await db.onlineOrder.findFirst({ where: { trackingToken, businessId: branch.businessId, branchId: branch.id }, include: { items: true } });
  if (!o) return null;

  const names = await addOnNames(db, o.businessId, o.items.flatMap((i) => i.addOnIds));
  const business = branch.business;
  const totals = calculateBill(o.items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, complimentary: false })), {
    discount: { kind: "none" },
    serviceChargeBps: business.serviceChargeBps,
    vatMode: business.vatMode,
    vatBps: business.vatBps,
    vatAppliesToServiceCharge: business.vatAppliesToServiceCharge,
    roundToRupee: business.roundToRupee,
    deliveryFee: o.deliveryFee,
    vatOnDeliveryFee: business.vatOnDeliveryFee,
  });

  // Once accepted it is a normal order: say how far along the kitchen is, and for delivery link the rider tracking page.
  let progress: { state: string; deliveryStatus: string | null; trackUrlToken: string | null } | null = null;
  if (o.status === "ACCEPTED" && o.orderId) {
    const order = await db.order.findFirst({ where: { id: o.orderId, businessId: o.businessId }, include: { items: { select: { status: true } } } });
    if (order) {
      const live = order.items.filter((i) => i.status !== "CANCELLED");
      const state = order.status === "PAID" ? "Completed" : order.status === "CANCELLED" ? "Cancelled" : live.length > 0 && live.every((i) => i.status === "SERVED") ? "Served" : live.length > 0 && live.every((i) => i.status === "READY" || i.status === "SERVED") ? "Ready" : live.some((i) => i.status === "PREPARING" || i.status === "READY") ? "Being prepared" : "Accepted";
      progress = { state, deliveryStatus: order.deliveryStatus ?? null, trackUrlToken: order.type === "DELIVERY" ? order.trackingToken : null };
    }
  }
  const text = statusText(o.status);
  return {
    businessName: business.name,
    branchName: branch.name,
    status: o.status,
    title: text.title,
    detail: o.status === "REJECTED" ? (o.rejectReason ?? "Sorry, we cannot prepare this right now.") : text.detail,
    type: o.type as OnlineType,
    items: o.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, addOnNames: i.addOnIds.map((id) => names.get(id) ?? "").filter(Boolean) })),
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    total: totals.grandTotal,
    address: o.address,
    prep: prepMessage(branch.onlinePrepMinutes, o.type as OnlineType),
    progress,
    canCancel: o.status === "PENDING",
    createdAt: o.createdAt,
  };
}

/** The customer cancels an order the restaurant has not answered yet. */
export async function cancelOnlineOrder(token: string, trackingToken: string): Promise<void> {
  if (!isToken(token) || !isToken(trackingToken)) throw new DomainError("Order not found.");
  const branch = await db.branch.findUnique({ where: { onlineToken: token }, select: { id: true, businessId: true } });
  if (!branch) throw new DomainError("Order not found.");
  const res = await db.onlineOrder.updateMany({
    where: { trackingToken, businessId: branch.businessId, branchId: branch.id, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
  if (res.count === 0) throw new DomainError("This order can no longer be cancelled. Please call the restaurant.");
  publishLive({ businessId: branch.businessId, branchId: branch.id, topic: "online" });
}

// ---------- staff ----------

function need(ctx: TenantContext) {
  if (!can(ctx, "order.edit")) throw new DomainError("You do not have permission to handle online orders.");
}

export async function getOnlineInbox(ctx: TenantContext) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const now = new Date();
  const orders = await db.onlineOrder.findMany({ where: { businessId, branchId, status: "PENDING" }, include: { items: true }, orderBy: { createdAt: "asc" } });
  const names = await addOnNames(db, businessId, orders.flatMap((o) => o.items.flatMap((i) => i.addOnIds)));
  return orders.map((o) => ({
    ...o,
    stale: isStale(o.createdAt, now),
    items: o.items.map((i) => ({ ...i, addOnNames: i.addOnIds.map((id) => names.get(id) ?? "").filter(Boolean) })),
  }));
}

export async function onlineInboxCount(ctx: TenantContext): Promise<number> {
  if (!can(ctx, "order.edit") || !ctx.branchId) return 0;
  return db.onlineOrder.count({ where: { businessId: ctx.businessId, branchId: ctx.branchId, status: "PENDING" } });
}

/** Recent decided orders, so staff can see what happened to the last few. */
export async function getRecentOnline(ctx: TenantContext) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  return db.onlineOrder.findMany({ where: { businessId, branchId, status: { not: "PENDING" } }, orderBy: { createdAt: "desc" }, take: 10, include: { items: true } });
}

/**
 * Turns the request into a real order: a takeaway or delivery order with the customer's items. In one transaction: claim the request
 * (two staff tapping Accept at once: only one wins), check the dishes again, find or make the customer, create the order.
 */
export async function acceptOnlineOrder(ctx: TenantContext, id: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const orderId = await db.$transaction(async (tx) => {
    const claimed = await tx.onlineOrder.updateMany({ where: { id, businessId, branchId, status: "PENDING" }, data: { status: "ACCEPTED", decidedAt: new Date(), decidedById: ctx.userId } });
    if (claimed.count === 0) throw new DomainError("Someone else already handled this order, or the customer cancelled it.");
    const oo = await tx.onlineOrder.findFirstOrThrow({ where: { id, businessId }, include: { items: true } });

    // The dishes are checked and priced again now: something may have run out since the customer ordered.
    const rules = await branchRules(tx, businessId, branchId);
    const menu = await tx.menuItem.findMany({ where: { businessId, id: { in: oo.items.map((i) => i.menuItemId) }, available: true }, select: { id: true, price: true } });
    const live = new Map(menu.filter((m) => rules.allowed(m.id)).map((m) => [m.id, m.price]));
    const gone = oo.items.filter((i) => !live.has(i.menuItemId)).map((i) => i.name);
    if (gone.length > 0) throw new DomainError(`No longer available: ${[...new Set(gone)].join(", ")}. Reject this order and tell the customer.`);

    const customer = await upsertCustomer(tx, businessId, oo.customerPhone, { name: oo.customerName });
    const { orderCounter } = await tx.business.update({ where: { id: businessId }, data: { orderCounter: { increment: 1 } }, select: { orderCounter: true } });
    const delivery = oo.type === "DELIVERY";
    const order = await tx.order.create({
      data: {
        businessId,
        branchId,
        number: orderCounter,
        type: oo.type,
        // Staff attach the customer; this number was typed by the customer online, so it is not confirmed in person yet.
        customerId: customer.id,
        customerConfirmed: false,
        note: oo.note ? `Online order: ${oo.note}` : "Online order",
        idempotencyKey: `online:${oo.id}`,
        createdById: ctx.userId,
        ...(delivery
          ? {
              deliveryName: oo.customerName,
              deliveryPhone: oo.customerPhone,
              deliveryAddress: oo.address,
              deliveryStatus: "PREPARING" as const,
              deliveryFee: oo.deliveryFee,
              deliveryZoneName: oo.deliveryZoneName,
              deliveryDistanceMeters: oo.deliveryMeters,
              destLat: oo.destLat,
              destLng: oo.destLng,
              trackingToken: randomBytes(24).toString("base64url"),
              riderToken: randomBytes(24).toString("base64url"),
            }
          : {}),
      },
    });
    for (const i of oo.items) {
      let priced;
      try {
        priced = await priceAddOns(tx, businessId, i.menuItemId, i.addOnIds, branchId);
      } catch (e) {
        if (e instanceof DomainError) throw new DomainError(`${i.name}: its options have changed. Reject this order and tell the customer.`);
        throw e;
      }
      await tx.orderItem.create({
        data: {
          businessId,
          orderId: order.id,
          menuItemId: i.menuItemId,
          name: i.name,
          unitPrice: (live.get(i.menuItemId) !== undefined ? rules.priceOf(i.menuItemId, live.get(i.menuItemId)!) : i.unitPrice) + priced.extra,
          quantity: i.quantity,
          note: i.note,
          addOns: { create: priced.chosen.map((c) => ({ businessId, addOnId: c.id, name: c.name, price: c.price })) },
        },
      });
    }
    await tx.onlineOrder.update({ where: { businessId_id: { businessId, id } }, data: { orderId: order.id } });
    await syncOrderStatus(tx, businessId, order.id);
    await audit(tx, ctx, "online.accept", "OnlineOrder", id, { orderNumber: order.number, type: oo.type });
    return { orderId: order.id, number: order.number, delivery: oo.type === "DELIVERY", phone: oo.customerPhone, address: oo.address, located: oo.destLat != null && oo.destLng != null ? { dest: { lat: oo.destLat, lng: oo.destLng }, meters: oo.deliveryMeters } : null };
  });
  await autoQueueKitchenSlip(businessId, branchId, orderId.orderId, ctx.userId);
  if (orderId.delivery && orderId.address) rememberPlace({ businessId, phone: orderId.phone, address: orderId.address, located: orderId.located });
  return { orderId: orderId.orderId, number: orderId.number };
}

export async function rejectOnlineOrder(ctx: TenantContext, id: string, reason?: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const clean = cleanText(reason, 200) || "Sorry, we cannot prepare this right now.";
  await db.$transaction(async (tx) => {
    const res = await tx.onlineOrder.updateMany({ where: { id, businessId, branchId, status: "PENDING" }, data: { status: "REJECTED", rejectReason: clean, decidedAt: new Date(), decidedById: ctx.userId } });
    if (res.count === 0) throw new DomainError("Someone else already handled this order, or the customer cancelled it.");
    await audit(tx, ctx, "online.reject", "OnlineOrder", id, { reason: clean });
  });
}

/** Requests nobody answered in time expire, so the customer is told instead of waiting for ever. Run by the timer. */
export async function expireStaleOnlineOrders(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LIMITS.staleMinutes * 60_000);
  const res = await db.onlineOrder.updateMany({ where: { status: "PENDING", createdAt: { lt: cutoff } }, data: { status: "EXPIRED", decidedAt: now } });
  return res.count;
}

// ---------- settings (owner and managers) ----------

function needManage(ctx: TenantContext) {
  if (!can(ctx, "branch.manage")) throw new DomainError("Only the owner can change online ordering settings.");
}

export async function getOnlineSettings(ctx: TenantContext) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const b = await db.branch.findFirstOrThrow({ where: { id: branchId, businessId } });
  return {
    name: b.name,
    enabled: b.onlineEnabled,
    token: can(ctx, "branch.manage") ? b.onlineToken : null,
    pickup: b.onlinePickup,
    delivery: b.onlineDelivery,
    minOrder: b.onlineMinOrder,
    prepMinutes: b.onlinePrepMinutes,
    notice: b.onlineNotice,
  };
}

export interface OnlineSettingsInput {
  enabled: boolean;
  pickup: boolean;
  delivery: boolean;
  minOrder: number;
  prepMinutes: number;
  notice: string;
}

export async function saveOnlineSettings(ctx: TenantContext, input: OnlineSettingsInput) {
  needManage(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!Number.isInteger(input.minOrder) || input.minOrder < 0 || input.minOrder > 10_000_000) throw new DomainError("The minimum order must be between Rs 0 and Rs 100,000.");
  if (!Number.isInteger(input.prepMinutes) || input.prepMinutes < 5 || input.prepMinutes > 240) throw new DomainError("Preparation time must be between 5 and 240 minutes.");
  if (input.enabled && !input.pickup && !input.delivery) throw new DomainError("Switch on pickup or delivery, or turn online ordering off.");
  await db.$transaction(async (tx) => {
    const cur = await tx.branch.findFirstOrThrow({ where: { id: branchId, businessId }, select: { onlineToken: true } });
    await tx.branch.update({
      where: { businessId_id: { businessId, id: branchId } },
      data: {
        onlineEnabled: input.enabled,
        onlinePickup: input.pickup,
        onlineDelivery: input.delivery,
        onlineMinOrder: input.minOrder,
        onlinePrepMinutes: input.prepMinutes,
        onlineNotice: cleanText(input.notice, 200) || null,
        // The link is made the first time ordering is switched on, and kept after that.
        ...(input.enabled && !cur.onlineToken ? { onlineToken: newToken() } : {}),
      },
    });
    await audit(tx, ctx, "online.settings", "Branch", branchId, { enabled: input.enabled, pickup: input.pickup, delivery: input.delivery });
  });
}

/** A new link: the old one stops working at once (for example after it was shared where it should not be). */
export async function rotateOnlineLink(ctx: TenantContext) {
  needManage(ctx);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    await tx.branch.update({ where: { businessId_id: { businessId, id: branchId } }, data: { onlineToken: newToken() } });
    await audit(tx, ctx, "online.link_rotated", "Branch", branchId);
  });
}
