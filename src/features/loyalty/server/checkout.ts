import { DomainError } from "@/server/errors";
import type { Tx } from "@/server/audit";
import {
  pointsEarned,
  redemptionDiscount,
  RedemptionError,
  type LoyaltySettings,
} from "@/features/loyalty/points";

/** Loyalty rules applied while a bill is previewed and paid. No access checks: callers do those. */

export function settingsFromBusiness(b: {
  loyaltyEnabled: boolean;
  pointsPer100: number;
  redeemPoints: number;
  redeemValue: number;
}): LoyaltySettings {
  return { enabled: b.loyaltyEnabled, pointsPer100: b.pointsPer100, redeemPoints: b.redeemPoints, redeemValue: b.redeemValue };
}

/**
 * Check a redemption request and return the discount it is worth. Points can only be spent
 * when loyalty is on, a customer is on the order, staff confirmed that person, and the
 * balance covers it.
 */
export function planRedemption(input: {
  settings: LoyaltySettings;
  order: { customerId: string | null; customerConfirmed: boolean };
  customer: { pointsBalance: number } | null;
  requestedPoints: number;
}): { points: number; discount: number } {
  const { settings, order, customer, requestedPoints } = input;
  if (!requestedPoints) return { points: 0, discount: 0 };
  if (!settings.enabled) throw new DomainError("Loyalty is switched off.");
  if (!order.customerId || !customer) throw new DomainError("Add a customer to the order to use points.");
  if (!order.customerConfirmed) {
    throw new DomainError("Confirm in person that this is the customer before using their points.");
  }
  let discount: number;
  try {
    discount = redemptionDiscount(requestedPoints, settings);
  } catch (e) {
    if (e instanceof RedemptionError) throw new DomainError(e.message);
    throw e;
  }
  if (requestedPoints > customer.pointsBalance) throw new DomainError("The customer does not have enough points.");
  return { points: requestedPoints, discount };
}

export function planEarn(settings: LoyaltySettings, order: { customerId: string | null }, grandTotal: number): number {
  return order.customerId ? pointsEarned(grandTotal, settings) : 0;
}

/**
 * Inside the checkout transaction: spend and earn points, and record the visit.
 * The redeem step is a conditional update, so two cashiers cannot both spend the same points.
 */
export async function applyCheckoutLoyalty(
  tx: Tx,
  input: {
    businessId: string;
    userId: string;
    customerId: string | null;
    invoiceId: string;
    grandTotal: number;
    redeemed: number;
    earned: number;
  },
) {
  const { businessId, customerId, invoiceId } = input;
  if (!customerId) return;

  if (input.redeemed > 0) {
    const res = await tx.customer.updateMany({
      where: { id: customerId, businessId, pointsBalance: { gte: input.redeemed } },
      data: { pointsBalance: { decrement: input.redeemed } },
    });
    if (res.count === 0) throw new DomainError("The customer's points changed. Please check the bill and try again.");
    await tx.loyaltyEntry.create({
      data: { businessId, customerId, kind: "REDEEM", points: -input.redeemed, invoiceId, createdById: input.userId },
    });
  }
  if (input.earned > 0) {
    await tx.loyaltyEntry.create({
      data: { businessId, customerId, kind: "EARN", points: input.earned, invoiceId, createdById: input.userId },
    });
  }
  await tx.customer.update({
    where: { businessId_id: { businessId, id: customerId } },
    data: {
      pointsBalance: { increment: input.earned },
      visitCount: { increment: 1 },
      totalSpend: { increment: input.grandTotal },
      lastVisitAt: new Date(),
    },
  });
}
