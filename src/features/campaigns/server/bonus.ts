import type { Tx } from "@/server/audit";

/**
 * Inside checkout: if the customer was sent a campaign offer that is still valid and unclaimed,
 * give the bonus points and tie this bill to the campaign. One offer per bill (the most recent).
 * Claiming is a conditional update, so two bills cannot both claim the same offer.
 * Returns the points given (0 if none).
 */
export async function applyCampaignBonus(
  tx: Tx,
  input: { businessId: string; customerId: string | null; invoiceId: string; userId: string; now?: Date },
): Promise<number> {
  const { businessId, customerId, invoiceId } = input;
  if (!customerId) return 0;
  const now = input.now ?? new Date();

  const offer = await tx.campaignMessage.findFirst({
    where: { businessId, customerId, status: "SENT", offerPoints: { gt: 0 }, redeemedAt: null, expiresAt: { gt: now } },
    orderBy: { sentAt: "desc" },
    include: { campaign: { select: { name: true } } },
  });
  if (!offer) return 0;

  const claimed = await tx.campaignMessage.updateMany({
    where: { id: offer.id, businessId, redeemedAt: null },
    data: { redeemedAt: now, redeemedInvoiceId: invoiceId },
  });
  if (claimed.count === 0) return 0;

  await tx.customer.update({
    where: { businessId_id: { businessId, id: customerId } },
    data: { pointsBalance: { increment: offer.offerPoints } },
  });
  await tx.loyaltyEntry.create({
    data: {
      businessId,
      customerId,
      kind: "EARN",
      points: offer.offerPoints,
      invoiceId,
      note: `Campaign: ${offer.campaign.name}`,
      createdById: input.userId,
    },
  });
  return offer.offerPoints;
}
