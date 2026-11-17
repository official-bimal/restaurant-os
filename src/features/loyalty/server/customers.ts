import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { normalizePhone } from "@/server/phone";
import { validateSettings, type LoyaltySettings } from "@/features/loyalty/points";

/**
 * Customers and loyalty settings. Every query is filtered by businessId.
 *
 * Trust model for phone numbers: nothing verifies them yet (no OTP). So a number a guest
 * types is "unconfirmed": it can earn points, but staff must confirm the person in front of
 * them before points can be spent, and marketing consent given on an unconfirmed number is
 * not usable for messages (consentVerified stays false).
 */

function needUse(ctx: TenantContext) {
  if (!can(ctx.role, "customer.use")) throw new DomainError("You do not have permission to use customer details.");
}
function needManage(ctx: TenantContext) {
  if (!can(ctx.role, "customer.manage")) throw new DomainError("You do not have permission to manage customers.");
}

function cleanName(value: string | undefined | null): string | null {
  const name = (value ?? "").trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length > 80) throw new DomainError("Name must be 80 characters or fewer.");
  return name;
}

/** Find or create the customer for a phone number. Never overwrites existing details. */
export async function upsertCustomer(
  tx: Tx,
  businessId: string,
  phone: string,
  opts: { name?: string | null; marketingConsent?: boolean; consentVerified?: boolean } = {},
) {
  const existing = await tx.customer.findUnique({ where: { businessId_phone: { businessId, phone } } });
  const name = cleanName(opts.name);
  if (existing) {
    const data: { name?: string; marketingConsent?: boolean; consentVerified?: boolean; consentAt?: Date } = {};
    if (name && !existing.name) data.name = name; // fill a blank name, never replace one
    // A guest can add consent for a number; only staff can ever remove or verify it.
    if (opts.marketingConsent && !existing.marketingConsent) {
      data.marketingConsent = true;
      data.consentAt = new Date();
      data.consentVerified = !!opts.consentVerified;
    }
    return Object.keys(data).length ? tx.customer.update({ where: { id: existing.id }, data }) : existing;
  }
  return tx.customer.create({
    data: {
      businessId,
      phone,
      name,
      marketingConsent: !!opts.marketingConsent,
      consentVerified: !!opts.marketingConsent && !!opts.consentVerified,
      consentAt: opts.marketingConsent ? new Date() : null,
    },
  });
}

// --- on an order (cashier at the counter) ---------------------------------

async function ownOpenOrder(ctx: TenantContext, orderId: string) {
  const order = await db.order.findFirst({ where: { id: orderId, ...scope(ctx) } });
  if (!order) throw new DomainError("Order not found.");
  if (order.status === "PAID" || order.status === "CANCELLED" || order.status === "MERGED") throw new DomainError("This order is closed.");
  return order;
}

/** Look up (or create) the customer by phone and attach them to the order. Staff did this in person, so it is confirmed. */
export async function attachCustomerToOrder(
  ctx: TenantContext,
  orderId: string,
  input: { phone: string; name?: string; marketingConsent?: boolean },
) {
  needUse(ctx);
  const phone = normalizePhone(input.phone);
  await ownOpenOrder(ctx, orderId);
  return db.$transaction(async (tx) => {
    const customer = await upsertCustomer(tx, ctx.businessId, phone, {
      name: input.name,
      marketingConsent: input.marketingConsent,
      consentVerified: true, // asked face to face
    });
    await tx.order.update({
      where: { businessId_id: { businessId: ctx.businessId, id: orderId } },
      data: { customerId: customer.id, customerConfirmed: true },
    });
    await audit(tx, ctx, "customer.attach", "Order", orderId, { customerId: customer.id });
    return customer;
  });
}

/** Staff checked the person in front of them is the owner of the number a guest typed. */
export async function confirmOrderCustomer(ctx: TenantContext, orderId: string) {
  needUse(ctx);
  const order = await ownOpenOrder(ctx, orderId);
  if (!order.customerId) throw new DomainError("There is no customer on this order.");
  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { businessId_id: { businessId: ctx.businessId, id: orderId } },
      data: { customerConfirmed: true },
    });
    await audit(tx, ctx, "customer.confirm", "Order", orderId, { customerId: order.customerId });
  });
}

export async function detachCustomerFromOrder(ctx: TenantContext, orderId: string) {
  needUse(ctx);
  await ownOpenOrder(ctx, orderId);
  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { businessId_id: { businessId: ctx.businessId, id: orderId } },
      data: { customerId: null, customerConfirmed: false },
    });
    await audit(tx, ctx, "customer.detach", "Order", orderId);
  });
}

/** The customer on an order, for the cashier's screen. Staff see the full number and balance. */
export async function getOrderLoyalty(ctx: TenantContext, orderId: string) {
  needUse(ctx);
  const order = await db.order.findFirst({ where: { id: orderId, ...scope(ctx) } });
  if (!order) throw new DomainError("Order not found.");
  const [customer, settings] = await Promise.all([
    order.customerId
      ? db.customer.findFirst({
          where: { id: order.customerId, businessId: ctx.businessId },
          select: { id: true, name: true, phone: true, pointsBalance: true, visitCount: true },
        })
      : null,
    getLoyaltySettings(ctx.businessId),
  ]);
  return { customer, confirmed: order.customerConfirmed, settings };
}

export async function getLoyaltySettings(businessId: string): Promise<LoyaltySettings> {
  const b = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { loyaltyEnabled: true, pointsPer100: true, redeemPoints: true, redeemValue: true },
  });
  return { enabled: b.loyaltyEnabled, pointsPer100: b.pointsPer100, redeemPoints: b.redeemPoints, redeemValue: b.redeemValue };
}

// --- management (owner / manager) ------------------------------------------

export async function setLoyaltySettings(ctx: TenantContext, input: LoyaltySettings) {
  needManage(ctx);
  const problem = validateSettings(input);
  if (problem) throw new DomainError(problem);
  if (input.enabled && (await db.customerOsLink.findUnique({ where: { businessId: ctx.businessId }, select: { businessId: true } }))) {
    throw new DomainError("Customer OS is connected and gives the points. Disconnect it first if you want points to be given here instead.");
  }
  await db.$transaction(async (tx) => {
    await tx.business.update({
      where: { id: ctx.businessId },
      data: {
        loyaltyEnabled: input.enabled,
        pointsPer100: input.pointsPer100,
        redeemPoints: input.redeemPoints,
        redeemValue: input.redeemValue,
      },
    });
    await audit(tx, ctx, "loyalty.settings", "Business", ctx.businessId, { ...input });
  });
}

export async function listCustomers(ctx: TenantContext, query?: string) {
  needManage(ctx);
  const q = (query ?? "").trim();
  const digits = q.replace(/\D/g, "");
  return db.customer.findMany({
    where: {
      businessId: ctx.businessId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    },
    orderBy: [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { firstSeenAt: "desc" }],
    take: 200,
  });
}

export async function getCustomer(ctx: TenantContext, id: string) {
  needManage(ctx);
  const customer = await db.customer.findFirst({
    where: { id, businessId: ctx.businessId },
    include: { entries: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!customer) throw new DomainError("Customer not found.");
  return customer;
}

export async function updateCustomer(
  ctx: TenantContext,
  id: string,
  input: { name?: string; marketingConsent: boolean },
) {
  needManage(ctx);
  const c = await db.customer.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!c) throw new DomainError("Customer not found.");
  const name = cleanName(input.name);
  await db.$transaction(async (tx) => {
    await tx.customer.update({
      where: { businessId_id: { businessId: ctx.businessId, id } },
      data: {
        name,
        marketingConsent: input.marketingConsent,
        // Staff recording consent (or its withdrawal) are the people who can vouch for it.
        consentVerified: input.marketingConsent,
        consentAt: input.marketingConsent && !c.marketingConsent ? new Date() : input.marketingConsent ? c.consentAt : null,
      },
    });
    await audit(tx, ctx, "customer.update", "Customer", id, { consent: input.marketingConsent });
  });
}

/** Manual correction (goodwill, mistakes). Needs a reason, is audited, and can never go below zero. */
export async function adjustPoints(ctx: TenantContext, id: string, input: { points: number; reason: string }) {
  needManage(ctx);
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DomainError("Give a reason for the adjustment.");
  if (!Number.isInteger(input.points) || input.points === 0 || Math.abs(input.points) > 100_000) {
    throw new DomainError("Enter a whole number of points, not zero.");
  }
  await db.$transaction(async (tx) => {
    // Conditional update: the balance can never be driven negative, even by two staff at once.
    const res = await tx.customer.updateMany({
      where: { id, businessId: ctx.businessId, ...(input.points < 0 ? { pointsBalance: { gte: -input.points } } : {}) },
      data: { pointsBalance: { increment: input.points } },
    });
    if (res.count === 0) {
      const exists = await tx.customer.findFirst({ where: { id, businessId: ctx.businessId }, select: { id: true } });
      throw new DomainError(exists ? "That would take the balance below zero." : "Customer not found.");
    }
    await tx.loyaltyEntry.create({
      data: { businessId: ctx.businessId, customerId: id, kind: "ADJUST", points: input.points, note: reason, createdById: ctx.userId },
    });
    await audit(tx, ctx, "loyalty.adjust", "Customer", id, { points: input.points, reason });
  });
}

/** Erase a customer's personal data (their request, or privacy law). Bills keep their numbers but lose the link. */
export async function deleteCustomer(ctx: TenantContext, id: string) {
  needManage(ctx);
  const c = await db.customer.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!c) throw new DomainError("Customer not found.");
  await db.$transaction(async (tx) => {
    await tx.order.updateMany({ where: { businessId: ctx.businessId, customerId: id }, data: { customerId: null, customerConfirmed: false } });
    await tx.invoice.updateMany({ where: { businessId: ctx.businessId, customerId: id }, data: { customerId: null } });
    await tx.tableSession.updateMany({ where: { businessId: ctx.businessId, customerId: id }, data: { customerId: null } });
    await tx.customer.delete({ where: { businessId_id: { businessId: ctx.businessId, id } } }); // ledger cascades
    // The audit record keeps no phone number or name.
    await audit(tx, ctx, "customer.delete", "Customer", id, { pointsBalance: c.pointsBalance, visits: c.visitCount });
  });
}
