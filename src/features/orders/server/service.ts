import { autoQueueKitchenSlip } from "@/features/printing/server/queue";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { scope } from "@/server/branch";
import { closeTableSittingsInTx } from "@/features/guest/server/service";
import { assertDayOpen } from "@/features/reports/server/day-lock";
import { deductForInvoice } from "@/features/stock/server/deduct";
import { applyCampaignBonus } from "@/features/campaigns/server/bonus";
import { applyCheckoutLoyalty, planEarn, planRedemption, settingsFromBusiness } from "@/features/loyalty/server/checkout";
import { enqueueIfLinked, flushSoon, recordRedeemed } from "@/features/customeros/server/outbox";
import { releaseReward, redeemRewardForBill, type UsedReward } from "@/features/customeros/server/reward";
import { syncOrderStatus } from "./sync";
import { randomBytes } from "node:crypto";
import { pushToTeam, pushToUser } from "@/features/notifications/server/push";
import { finishData } from "@/features/delivery/server/service";
import { settleBatchIfDone } from "@/features/delivery/server/batch-state";
import { orderableItemIds } from "@/features/menu/server/menu-sets";
import { branchMenuOverrides, effectiveItem, hiddenCategoryIds } from "@/features/menu/server/branch-menu";
import { priceAddOns } from "@/features/menu/server/pricing";
import { canMoveDelivery, cleanDelivery, type DeliveryInput } from "./delivery";
import { locateDestination, quoteDeliveryFee, rememberPlace } from "@/features/delivery/server/fee";
import type { TenantContext } from "@/server/auth";
import { can, type Permission } from "@/server/permissions";
import { Prisma } from "@/generated/prisma/client";
import type { ItemStatus, OrderType, PaymentMethod } from "@/generated/prisma/enums";
import { calculateBill, type DiscountInput } from "@/features/billing/calc";
import { canTransitionItem } from "@/features/orders/status";

/**
 * Order service. Every function takes a TenantContext built server-side and
 * filters by ctx.businessId. A businessId from the browser is never accepted.
 */

export { DomainError };

function need(ctx: TenantContext, permission: Permission) {
  if (!can(ctx.role, permission)) throw new DomainError("You do not have permission to do that.");
}

const ORDER_INCLUDE = {
  table: true,
  branch: { select: { latitude: true, longitude: true } },
  items: { orderBy: { createdAt: "asc" as const }, include: { addOns: true } },
  invoice: { include: { payments: true, creditNotes: { orderBy: { number: "asc" as const } } } },
};

export async function listOpenOrders(ctx: TenantContext) {
  return db.order.findMany({
    where: { ...scope(ctx), status: { in: ["OPEN", "SERVED"] } },
    include: { table: true, items: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getOrder(ctx: TenantContext, orderId: string) {
  return db.order.findFirst({
    where: { id: orderId, ...scope(ctx) },
    include: ORDER_INCLUDE,
  });
}

export async function listTables(ctx: TenantContext) {
  return db.diningTable.findMany({
    where: scope(ctx),
    include: { area: true },
    orderBy: [{ area: { sortOrder: "asc" } }, { label: "asc" }],
  });
}

/**
 * The menu a waiter can order from right now in this branch: available dishes, at this branch's prices, limited to the
 * active menu set.
 */
export async function listMenu(ctx: TenantContext) {
  const [categories, orderable, overrides, hidden] = await Promise.all([
    db.menuCategory.findMany({
      where: { businessId: ctx.businessId },
      include: { items: { where: { available: true }, orderBy: { name: "asc" } } },
      orderBy: { sortOrder: "asc" },
    }),
    orderableItemIds(db, ctx.businessId, ctx.branchId),
    branchMenuOverrides(db, ctx.businessId, ctx.branchId),
    hiddenCategoryIds(db, ctx.businessId, ctx.branchId),
  ]);
  return categories.map((c) => ({
    ...c,
    items: c.items
      .map((i) => ({ ...i, ...effectiveItem(i, overrides.get(i.id), hidden) }))
      .filter((i) => i.available && (!orderable || orderable.has(i.id))),
  }));
}

/**
 * Create an order. Safe to retry: the same idempotencyKey returns the order
 * that was already created instead of making a second one.
 */
export async function createOrder(
  ctx: TenantContext,
  input: { type: OrderType; tableId?: string | null; idempotencyKey: string; delivery?: DeliveryInput & { zoneId?: string; distanceKm?: number | string } },
) {
  need(ctx, "order.create");
  const { businessId, branchId } = scope(ctx);

  const existing = await db.order.findUnique({
    where: { businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey } },
  });
  // A repeat tap returns the first order, but only if it is in this branch.
  if (existing) {
    if (existing.branchId !== branchId) throw new DomainError("Something went wrong. Please try again.");
    return existing;
  }

  if (input.type === "DINE_IN" && !input.tableId) throw new DomainError("Choose a table.");
  const delivery = input.type === "DELIVERY" ? cleanDelivery(input.delivery) : null;

  // A location (coordinates or a map link) gives the distance automatically and a point for the map.
  // Done before the transaction because a routing server, if one is set up, is a network call.
  const located = delivery ? await locateDestination({ businessId, branchId, address: delivery.address, phone: delivery.phone, location: input.delivery?.location }) : null;

  try {
    const created = await db.$transaction(async (tx) => {
      if (input.type === "DINE_IN" && input.tableId) {
        const table = await tx.diningTable.findFirst({ where: { id: input.tableId, businessId, branchId } });
        if (!table) throw new DomainError("Table not found.");
        const busy = await tx.order.findFirst({
          where: { businessId, tableId: table.id, status: { in: ["OPEN", "SERVED"] } },
        });
        if (busy) throw new DomainError(`${table.label} already has an open order.`);
        await tx.diningTable.update({
          where: { businessId_id: { businessId, id: table.id } },
          data: { state: "SEATED" },
        });
      }
      // Delivery fee: by distance when the branch has distance bands, else by the zone chosen, else free.
      const zone = delivery ? await quoteDeliveryFee(tx, { businessId, branchId, located, distanceKm: input.delivery?.distanceKm, zoneId: input.delivery?.zoneId }) : null;
      const { orderCounter } = await tx.business.update({
        where: { id: businessId },
        data: { orderCounter: { increment: 1 } },
        select: { orderCounter: true },
      });
      const order = await tx.order.create({
        data: {
          businessId,
          branchId,
          number: orderCounter,
          type: input.type,
          tableId: input.type === "DINE_IN" ? input.tableId : null,
          idempotencyKey: input.idempotencyKey,
          createdById: ctx.userId,
          ...(delivery
            ? {
                deliveryName: delivery.name,
                deliveryPhone: delivery.phone,
                deliveryAddress: delivery.address,
                deliveryStatus: "PREPARING" as const,
                deliveryFee: zone?.fee ?? 0,
                deliveryZoneName: zone?.name ?? null,
                deliveryDistanceMeters: zone?.meters ?? null,
                destLat: located?.dest.lat ?? null,
                destLng: located?.dest.lng ?? null,
                trackingToken: randomBytes(24).toString("base64url"),
                riderToken: randomBytes(24).toString("base64url"),
              }
            : {}),
        },
      });
      await audit(tx, ctx, "order.create", "Order", order.id, { number: order.number });
      return order;
    });
    // Remember where this customer was delivered to, so the next order to the same address needs no lookup.
    if (delivery) rememberPlace({ businessId, phone: delivery.phone, address: delivery.address, located });
    return created;
  } catch (e) {
    // Two identical requests raced: the loser finds the winner's order.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.order.findUnique({
        where: { businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey } },
      });
      if (again) return again;
    }
    throw e;
  }
}

export async function addItem(
  ctx: TenantContext,
  orderId: string,
  input: { menuItemId: string; quantity: number; note?: string; addOnIds?: string[] },
) {
  need(ctx, "order.edit");
  const { businessId, branchId } = scope(ctx);
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) {
    throw new DomainError("Quantity must be between 1 and 99.");
  }
  const created = await db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, businessId, branchId } });
    if (!order) throw new DomainError("Order not found.");
    if (order.status === "PAID" || order.status === "CANCELLED" || order.status === "MERGED") {
      throw new DomainError("This order is closed.");
    }
    const menuItem = await tx.menuItem.findFirst({
      where: { id: input.menuItemId, businessId, available: true },
    });
    if (!menuItem) throw new DomainError("That menu item is not available.");
    const here = effectiveItem(menuItem, (await branchMenuOverrides(tx, businessId, branchId)).get(menuItem.id), await hiddenCategoryIds(tx, businessId, branchId));
    if (!here.available) throw new DomainError("That dish is not offered at this branch.");
    const orderable = await orderableItemIds(tx, businessId, branchId);
    if (orderable && !orderable.has(menuItem.id)) throw new DomainError("That dish is not on the menu right now.");

    // Extras the waiter picked, checked against what this dish actually offers.
    const { chosen, extra } = await priceAddOns(tx, businessId, menuItem.id, input.addOnIds ?? [], branchId);

    const item = await tx.orderItem.create({
      data: {
        businessId,
        orderId,
        menuItemId: menuItem.id,
        name: menuItem.name,
        unitPrice: here.price + extra,
        quantity: input.quantity,
        note: input.note?.trim() || null,
        addOns: { create: chosen.map((c) => ({ businessId, addOnId: c.id, name: c.name, price: c.price })) },
      },
    });
    await syncOrderStatus(tx, businessId, orderId);
    await audit(tx, ctx, "order.addItem", "OrderItem", item.id, {
      name: item.name,
      qty: item.quantity,
      addOns: chosen.map((c) => c.name),
    });
    return item;
  });
  // If this business prints kitchen slips by itself, put one in the print queue (never blocks the order).
  void autoQueueKitchenSlip(businessId, branchId, orderId, ctx.userId);
  return created;
}

export async function setItemStatus(ctx: TenantContext, itemId: string, to: ItemStatus) {
  const permission: Permission = to === "SERVED" ? "order.edit" : "kitchen.update";
  if (!can(ctx.role, permission) && !can(ctx.role, "kitchen.update")) {
    throw new DomainError("You do not have permission to do that.");
  }
  const { businessId, branchId } = scope(ctx);
  return db.$transaction(async (tx) => {
    const item = await tx.orderItem.findFirst({ where: { id: itemId, businessId, order: { branchId } } });
    if (!item) throw new DomainError("Item not found.");
    if (!canTransitionItem(item.status, to)) {
      throw new DomainError(`An item that is ${item.status.toLowerCase()} cannot become ${to.toLowerCase()}.`);
    }
    const updated = await tx.orderItem.update({
      where: { id: item.id },
      data: { status: to, statusAt: new Date() },
    });
    await syncOrderStatus(tx, businessId, item.orderId);
    await audit(tx, ctx, "item.status", "OrderItem", item.id, { from: item.status, to });
    return updated;
  });
}

export async function cancelItem(ctx: TenantContext, itemId: string, reason: string) {
  need(ctx, "order.cancelItem");
  const clean = reason.trim();
  if (clean.length < 3) throw new DomainError("Give a reason for cancelling.");
  const { businessId, branchId } = scope(ctx);
  return db.$transaction(async (tx) => {
    const item = await tx.orderItem.findFirst({ where: { id: itemId, businessId, order: { branchId } } });
    if (!item) throw new DomainError("Item not found.");
    if (!canTransitionItem(item.status, "CANCELLED")) {
      throw new DomainError("This item can no longer be cancelled.");
    }
    await tx.orderItem.update({
      where: { id: item.id },
      data: { status: "CANCELLED", cancelReason: clean, statusAt: new Date() },
    });
    await syncOrderStatus(tx, businessId, item.orderId);
    await audit(tx, ctx, "item.cancel", "OrderItem", item.id, { reason: clean });
  });
}

export interface CheckoutInput {
  discount: DiscountInput;
  payments: { method: PaymentMethod; amount: number }[];
  /** Loyalty points to spend on this bill (whole redeem blocks). */
  redeemPoints?: number;
  /** A Customer OS reward to use on this bill (its id). Used in Customer OS first, given back if the bill cannot be paid. */
  rewardId?: string;
  /** For a free-item reward: which item on the order is free (one unit of it comes off the bill). */
  freeItemId?: string;
}

/** Totals for an order using the business's tax settings, including any loyalty reward being applied. */
export async function previewBill(ctx: TenantContext, orderId: string, discount: DiscountInput, redeemPoints = 0, reward: { valueMinor: number } | null = null) {
  const order = await getOrder(ctx, orderId);
  if (!order) throw new DomainError("Order not found.");
  const business = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
  const settings = settingsFromBusiness(business);
  const customer = order.customerId
    ? await db.customer.findFirst({ where: { id: order.customerId, businessId: ctx.businessId }, select: { pointsBalance: true } })
    : null;
  const plan = planRedemption({ settings, order, customer, requestedPoints: redeemPoints });
  let totals;
  try {
    totals = calculateBill(
      order.items
        .filter((i) => i.status !== "CANCELLED")
        .map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, complimentary: i.complimentary })),
      {
        discount,
        loyaltyDiscount: plan.discount + (reward?.valueMinor ?? 0),
        serviceChargeBps: business.serviceChargeBps,
        vatMode: business.vatMode,
        vatBps: business.vatBps,
        vatAppliesToServiceCharge: business.vatAppliesToServiceCharge,
        roundToRupee: business.roundToRupee,
        deliveryFee: order.deliveryFee,
        vatOnDeliveryFee: business.vatOnDeliveryFee,
      },
    );
  } catch (e) {
    if (e instanceof RangeError) throw new DomainError(e.message);
    throw e;
  }
  // Points are earned on the food, not on the delivery fee.
  return { ...totals, redeemPoints: plan.points, pointsToEarn: planEarn(settings, order, totals.grandTotal - totals.deliveryFee) };
}

export async function checkout(ctx: TenantContext, orderId: string, input: CheckoutInput) {
  need(ctx, "bill.checkout");
  const { businessId, branchId } = scope(ctx);
  let lowStock: { name: string; status: string }[] = [];
  let queuedForCustomerOs = false;

  // A Customer OS reward is used there FIRST (it needs the customer's say-so and can fail). If the bill then cannot be paid, it is given back.
  let used: UsedReward | null = null;
  if (input.rewardId) {
    const pre = await db.order.findFirst({ where: { id: orderId, businessId, branchId }, select: { customerId: true, customerConfirmed: true, status: true, invoice: { select: { id: true } } } });
    if (!pre) throw new DomainError("Order not found.");
    if (!pre.invoice && !["PAID", "CANCELLED", "MERGED"].includes(pre.status)) {
      used = await redeemRewardForBill(ctx, { orderId, customerId: pre.customerId, confirmed: pre.customerConfirmed, rewardId: input.rewardId, freeItemId: input.freeItemId });
    }
  }
  const invoice = await releaseIfNotPaid(used, businessId, orderId, () => db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, businessId, branchId },
      include: { items: { include: { addOns: { select: { addOnId: true } } } }, invoice: true },
    });
    if (!order) throw new DomainError("Order not found.");
    if (order.invoice || order.status === "PAID") throw new DomainError("This order is already paid.");
    if (order.status === "CANCELLED") throw new DomainError("This order was cancelled.");
    if (order.status === "MERGED") throw new DomainError("This bill was merged into another one. Pay that one instead.");

    const active = order.items.filter((i) => i.status !== "CANCELLED");
    if (active.length === 0) throw new DomainError("There is nothing to bill.");
    await assertDayOpen(tx, businessId, branchId);

    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    const settings = settingsFromBusiness(business);
    const customer = order.customerId
      ? await tx.customer.findFirst({ where: { id: order.customerId, businessId }, select: { pointsBalance: true } })
      : null;
    const plan = planRedemption({ settings, order, customer, requestedPoints: input.redeemPoints ?? 0 });
    let totals;
    try {
      totals = calculateBill(
        active.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, complimentary: i.complimentary })),
        {
          discount: input.discount,
          loyaltyDiscount: plan.discount + (used?.valueMinor ?? 0),
          serviceChargeBps: business.serviceChargeBps,
          vatMode: business.vatMode,
          vatBps: business.vatBps,
          vatAppliesToServiceCharge: business.vatAppliesToServiceCharge,
          roundToRupee: business.roundToRupee,
          deliveryFee: order.deliveryFee,
          vatOnDeliveryFee: business.vatOnDeliveryFee,
        },
      );
    } catch (e) {
      if (e instanceof RangeError) throw new DomainError(e.message);
      throw e;
    }
    const earned = planEarn(settings, order, totals.grandTotal - totals.deliveryFee);

    const paid = input.payments.reduce((sum, p) => sum + p.amount, 0);
    if (input.payments.some((p) => !Number.isInteger(p.amount) || p.amount <= 0)) {
      throw new DomainError("Payment amounts must be positive.");
    }
    if (paid !== totals.grandTotal) {
      throw new DomainError("Payments must add up exactly to the bill total.");
    }

    const { invoiceCounter } = await tx.business.update({
      where: { id: businessId },
      data: { invoiceCounter: { increment: 1 } },
      select: { invoiceCounter: true },
    });
    const invoice = await tx.invoice.create({
      data: {
        businessId,
        branchId,
        orderId,
        number: invoiceCounter,
        subtotal: totals.subtotal,
        discount: totals.discount,
        serviceCharge: totals.serviceCharge,
        vat: totals.vat,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        loyaltyDiscount: totals.loyaltyDiscount,
        deliveryFee: totals.deliveryFee,
        customerId: order.customerId,
        pointsEarned: earned,
        pointsRedeemed: plan.points + (used?.consumed ?? 0),
      },
    });
    await applyCheckoutLoyalty(tx, {
      businessId,
      userId: ctx.userId,
      customerId: order.customerId,
      invoiceId: invoice.id,
      grandTotal: totals.grandTotal,
      redeemed: plan.points,
      earned,
    });
    // If Customer OS is connected, the sale is queued for it in this same transaction (sent after the sale is saved).
    queuedForCustomerOs = await enqueueIfLinked(tx, { businessId, invoiceId: invoice.id, customerId: order.customerId });
    // The reward already used in Customer OS now belongs to this paid bill, so it can never be given back later.
    if (used) await recordRedeemed(tx, { businessId, orderId, externalId: used.externalId, consumed: used.consumed });
    // A win-back offer the customer was sent and has now acted on.
    await applyCampaignBonus(tx, { businessId, customerId: order.customerId, invoiceId: invoice.id, userId: ctx.userId });
    // What the kitchen used, from the recipes of everything on the bill (complimentary dishes use stock too).
    lowStock = await deductForInvoice(tx, {
      businessId,
      branchId,
      invoiceId: invoice.id,
      userId: ctx.userId,
      items: active.map((i) => ({
        menuItemId: i.menuItemId,
        quantity: i.quantity,
        addOnIds: i.addOns.flatMap((a) => (a.addOnId ? [a.addOnId] : [])),
      })),
    });
    await tx.payment.createMany({
      data: input.payments.map((p) => ({
        businessId,
        invoiceId: invoice.id,
        method: p.method,
        amount: p.amount,
      })),
    });
    await tx.order.update({
      where: { businessId_id: { businessId, id: orderId } },
      data: { status: "PAID", closedAt: new Date() },
    });
    if (order.tableId) {
      // A split leaves other bills open at the same table: the party is still seated and
      // their phones keep working until the last bill is paid.
      const remaining = await tx.order.count({
        where: { businessId, tableId: order.tableId, status: { in: ["OPEN", "SERVED"] }, id: { not: orderId } },
      });
      if (remaining === 0) {
        await tx.diningTable.update({
          where: { businessId_id: { businessId, id: order.tableId } },
          data: { state: "FREE" },
        });
        // The last bill is paid: end the guests' sitting so their phones stop ordering against it.
        await closeTableSittingsInTx(tx, businessId, order.tableId, { reason: "PAID", invoiceId: invoice.id });
      }
    }
    await audit(tx, ctx, "bill.checkout", "Invoice", invoice.id, {
      number: invoice.number,
      total: totals.grandTotal,
      ...(used ? { reward: used.name, rewardValue: used.valueMinor, ...(used.itemName ? { freeItem: used.itemName } : {}) } : {}),
    });
    return invoice;
  }));
  // After the sale is safely saved: hand it to Customer OS in the background (a failure never touches the sale).
  if (queuedForCustomerOs) flushSoon(businessId);
  // And tell the people who look after stock that something just ran low.
  if (lowStock.length > 0) {
    const names = lowStock.map((i) => i.name);
    const out = lowStock.some((i) => i.status !== "LOW");
    void pushToTeam({
      businessId,
      branchId,
      permission: "stock.view",
      payload: {
        title: out ? "Stock has run out" : "Stock is running low",
        body: names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", "),
        url: "/stock",
        tag: "low-stock",
      },
    });
  }
  return invoice;
}

/** Tickets for the kitchen display: items still needing work, oldest first. */
export async function kitchenTickets(ctx: TenantContext) {
  const rows = await db.orderItem.findMany({
    where: {
      businessId: ctx.businessId,
      status: { in: ["PENDING", "PREPARING", "READY"] },
      order: { branchId: ctx.branchId, status: { in: ["OPEN", "SERVED"] } },
    },
    include: { addOns: true, order: { include: { table: true } }, menuItem: { include: { station: true } } },
    orderBy: { createdAt: "asc" },
  });
  // A branch can send a dish to a different station than the shared menu does.
  const stationOverrides = await db.branchMenuItem.findMany({
    where: { businessId: ctx.businessId, branchId: ctx.branchId, stationId: { not: null }, menuItemId: { in: [...new Set(rows.map((r) => r.menuItemId))] } },
    include: { station: true },
  });
  const station = new Map(stationOverrides.map((o) => [o.menuItemId, o.station]));
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    menuItem: { ...r.menuItem, station: station.get(r.menuItemId) ?? r.menuItem.station },
    ageMinutes: Math.floor((now - r.createdAt.getTime()) / 60_000),
  }));
}

// --- helpers -------------------------------------------------------------

/** Give a delivery to a rider account: it then shows on their own page, where they pick it up. */
export async function assignRider(ctx: TenantContext, orderId: string, riderUserId: string) {
  need(ctx, "order.edit");
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, businessId, branchId, type: "DELIVERY" } });
    if (!order || !order.deliveryStatus) throw new DomainError("Delivery order not found.");
    if (order.status === "CANCELLED" || order.status === "MERGED") throw new DomainError("This order was cancelled.");
    if (order.deliveryStatus !== "PREPARING") throw new DomainError("This delivery has already left. The rider cannot be changed now.");
    const m = await tx.membership.findFirst({
      where: { businessId, userId: riderUserId, role: "RIDER", OR: [{ allBranches: true }, { branches: { some: { branchId } } }] },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!m) throw new DomainError("That rider is not available for this branch.");
    await tx.order.update({
      where: { businessId_id: { businessId, id: orderId } },
      data: { riderUserId: m.user.id, riderName: m.user.name },
    });
    await audit(tx, ctx, "order.assignRider", "Order", orderId, { rider: m.user.name });
    return { riderId: m.user.id, number: order.number };
  }).then((r) => {
    void pushToUser({
      businessId,
      userId: r.riderId,
      payload: { title: "New delivery for you", body: `Delivery #${r.number} is being prepared.`, url: "/deliveries", tag: `rider-${orderId}` },
    });
  });
}

/** Delivery orders: preparing, out for delivery, delivered or failed. Separate from paying the bill. */
export async function setDeliveryStatus(
  ctx: TenantContext,
  orderId: string,
  input: { status: "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED"; riderName?: string; riderUserId?: string },
) {
  need(ctx, "order.edit");
  const { businessId, branchId } = scope(ctx);
  const rider = input.riderName?.trim().replace(/\s+/g, " ").slice(0, 60) || null;
  return db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, businessId, branchId, type: "DELIVERY" } });
    if (!order || !order.deliveryStatus) throw new DomainError("Delivery order not found.");
    if (order.status === "CANCELLED" || order.status === "MERGED") throw new DomainError("This order was cancelled.");
    if (!canMoveDelivery(order.deliveryStatus, input.status)) {
      throw new DomainError("That delivery cannot move to that step.");
    }
    // A rider account may be chosen instead of typing a name: it must be a rider of this business who works in this branch.
    let riderAccount: { id: string; name: string } | null = null;
    if (input.riderUserId) {
      const m = await tx.membership.findFirst({
        where: {
          businessId,
          userId: input.riderUserId,
          role: "RIDER",
          OR: [{ allBranches: true }, { branches: { some: { branchId } } }],
        },
        include: { user: { select: { id: true, name: true } } },
      });
      if (!m) throw new DomainError("That rider is not available for this branch.");
      riderAccount = m.user;
    }
    if (input.status === "OUT_FOR_DELIVERY" && !riderAccount && !rider && !order.riderName) throw new DomainError("Choose or enter the rider.");
    await tx.order.update({
      where: { businessId_id: { businessId, id: orderId } },
      data: {
        deliveryStatus: input.status,
        ...(riderAccount ? { riderUserId: riderAccount.id, riderName: riderAccount.name } : rider ? { riderName: rider, riderUserId: null } : {}),
        // Ending a delivery wipes the rider's position and records the cash collected and the pay earned.
        ...(await finishData(tx, { ...order, riderUserId: riderAccount?.id ?? order.riderUserId }, input.status)),
      },
    });
    if (input.status !== "OUT_FOR_DELIVERY") await settleBatchIfDone(tx, businessId, order.batchId);
    await audit(tx, ctx, "order.delivery", "Order", orderId, { from: order.deliveryStatus, to: input.status, rider: rider ?? order.riderName });
  });
}

/** Runs the payment; if it fails after a Customer OS reward was used for it, the reward's points are given back before the error goes on. */
async function releaseIfNotPaid<T>(used: UsedReward | null, businessId: string, orderId: string, pay: () => Promise<T>): Promise<T> {
  try {
    return await pay();
  } catch (e) {
    if (used) await releaseReward(businessId, orderId, used.externalId);
    throw e;
  }
}
