import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import {
  isSegment,
  renderTemplate,
  segmentOf,
  SEGMENTS,
  validateTemplate,
  type Segment,
} from "@/features/campaigns/segments";

/**
 * Campaigns. The app PREPARES messages and measures what they do; it never sends anything.
 * Staff copy the text, open it in their phone's messaging app or export the list, send it
 * themselves, then mark it sent. A customer can be messaged only while they have agreed to offers
 * AND that agreement has been confirmed by staff; this is re-checked every time a message is
 * shown, exported or marked sent, so withdrawing consent stops everything straight away.
 * Every query is filtered by businessId.
 */

function need(ctx: TenantContext) {
  if (!can(ctx, "campaign.manage")) throw new DomainError("You do not have permission to manage campaigns.");
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A customer is not put in a new campaign if one was prepared for them this recently. */
export const MIN_DAYS_BETWEEN_MESSAGES = 7;

const canMessage = (c: { marketingConsent: boolean; consentVerified: boolean }) => c.marketingConsent && c.consentVerified;

// --- segments ------------------------------------------------------------------

export async function segmentCounts(ctx: TenantContext) {
  need(ctx);
  const now = new Date();
  const customers = await db.customer.findMany({
    where: { businessId: ctx.businessId },
    select: { visitCount: true, totalSpend: true, lastVisitAt: true, marketingConsent: true, consentVerified: true },
  });
  const counts = Object.fromEntries(SEGMENTS.map((s) => [s, { total: 0, reachable: 0 }])) as Record<Segment, { total: number; reachable: number }>;
  for (const c of customers) {
    const seg = segmentOf(c, now);
    counts[seg].total += 1;
    if (canMessage(c)) counts[seg].reachable += 1;
  }
  return counts;
}

// --- campaigns -----------------------------------------------------------------

export interface CampaignInput {
  name: string;
  segment: string;
  template: string;
  offerPoints: number;
  offerDays: number;
}

export async function createCampaign(ctx: TenantContext, input: CampaignInput) {
  need(ctx);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 80) throw new DomainError("Name must be 1 to 80 characters.");
  if (!isSegment(input.segment)) throw new DomainError("Choose who the message is for.");
  let template: string;
  try {
    template = validateTemplate(input.template);
  } catch (e) {
    throw new DomainError((e as Error).message);
  }
  if (!Number.isInteger(input.offerPoints) || input.offerPoints < 0 || input.offerPoints > 10_000) {
    throw new DomainError("Bonus points must be a whole number from 0 to 10,000.");
  }
  if (!Number.isInteger(input.offerDays) || input.offerDays < 1 || input.offerDays > 90) {
    throw new DomainError("The offer must last between 1 and 90 days.");
  }
  return db.$transaction(async (tx) => {
    const c = await tx.campaign.create({
      data: {
        businessId: ctx.businessId,
        name,
        segment: input.segment,
        template,
        offerPoints: input.offerPoints,
        offerDays: input.offerDays,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, "campaign.create", "Campaign", c.id, { name, segment: input.segment, offerPoints: input.offerPoints });
    return c;
  });
}

/** Work out who gets the message and write each person's text. Can only be done once per campaign. */
export async function prepareCampaign(ctx: TenantContext, campaignId: string) {
  need(ctx);
  return db.$transaction(async (tx) => {
    const campaign = await tx.campaign.findFirst({ where: { id: campaignId, businessId: ctx.businessId } });
    if (!campaign) throw new DomainError("Campaign not found.");
    if (campaign.preparedAt) throw new DomainError("This campaign has already been prepared.");

    const now = new Date();
    const business = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { name: true } });
    const customers = await tx.customer.findMany({ where: { businessId: ctx.businessId } });
    const recent = await tx.campaignMessage.findMany({
      where: { businessId: ctx.businessId, createdAt: { gt: new Date(now.getTime() - MIN_DAYS_BETWEEN_MESSAGES * DAY_MS) } },
      select: { customerId: true },
    });
    const recentlyMessaged = new Set(recent.map((m) => m.customerId));

    let inSegment = 0;
    let noConsent = 0;
    let tooSoon = 0;
    const rows: { customerId: string; text: string }[] = [];
    for (const c of customers) {
      if (segmentOf(c, now) !== campaign.segment) continue;
      inSegment += 1;
      if (!canMessage(c)) {
        noConsent += 1;
        continue;
      }
      if (recentlyMessaged.has(c.id)) {
        tooSoon += 1;
        continue;
      }
      rows.push({
        customerId: c.id,
        text: renderTemplate(campaign.template, {
          name: c.name,
          points: campaign.offerPoints,
          days: campaign.offerDays,
          business: business.name,
        }),
      });
    }

    if (rows.length > 0) {
      await tx.campaignMessage.createMany({
        data: rows.map((r) => ({
          businessId: ctx.businessId,
          campaignId: campaign.id,
          customerId: r.customerId,
          text: r.text,
          offerPoints: campaign.offerPoints,
        })),
      });
    }
    await tx.campaign.update({ where: { businessId_id: { businessId: ctx.businessId, id: campaign.id } }, data: { preparedAt: now } });
    await audit(tx, ctx, "campaign.prepare", "Campaign", campaign.id, { inSegment, prepared: rows.length, noConsent, tooSoon });
    return { inSegment, prepared: rows.length, noConsent, tooSoon };
  });
}

// --- stats ---------------------------------------------------------------------

interface MessageForStats {
  customerId: string;
  status: "QUEUED" | "SENT";
  sentAt: Date | null;
  offerPoints: number;
  redeemedAt: Date | null;
  redeemedInvoiceId: string | null;
}

async function statsFor(businessId: string, offerDays: number, messages: MessageForStats[]) {
  const sent = messages.filter((m) => m.status === "SENT" && m.sentAt);
  const redeemed = messages.filter((m) => m.redeemedAt);
  const invoiceIds = redeemed.map((m) => m.redeemedInvoiceId).filter((x): x is string => !!x);
  const revenueRows = invoiceIds.length
    ? await db.invoice.findMany({ where: { businessId, id: { in: invoiceIds } }, select: { grandTotal: true } })
    : [];

  // "Came back": paid a bill within the offer window after being messaged, offer claimed or not.
  let returned = 0;
  if (sent.length > 0) {
    const earliest = new Date(Math.min(...sent.map((m) => m.sentAt!.getTime())));
    const invoices = await db.invoice.findMany({
      where: { businessId, customerId: { in: sent.map((m) => m.customerId) }, createdAt: { gt: earliest } },
      select: { customerId: true, createdAt: true },
    });
    const byCustomer = new Map<string, Date[]>();
    for (const i of invoices) byCustomer.set(i.customerId!, [...(byCustomer.get(i.customerId!) ?? []), i.createdAt]);
    for (const m of sent) {
      const end = m.sentAt!.getTime() + offerDays * DAY_MS;
      if ((byCustomer.get(m.customerId) ?? []).some((d) => d.getTime() > m.sentAt!.getTime() && d.getTime() <= end)) returned += 1;
    }
  }

  return {
    prepared: messages.length,
    sent: sent.length,
    returned,
    redeemed: redeemed.length,
    revenue: revenueRows.reduce((n, i) => n + i.grandTotal, 0),
    pointsGiven: redeemed.reduce((n, m) => n + m.offerPoints, 0),
  };
}

export async function listCampaigns(ctx: TenantContext) {
  need(ctx);
  const campaigns = await db.campaign.findMany({
    where: { businessId: ctx.businessId },
    include: { messages: { select: { customerId: true, status: true, sentAt: true, offerPoints: true, redeemedAt: true, redeemedInvoiceId: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Promise.all(
    campaigns.map(async (c) => ({
      id: c.id,
      name: c.name,
      segment: c.segment,
      offerPoints: c.offerPoints,
      offerDays: c.offerDays,
      createdAt: c.createdAt,
      preparedAt: c.preparedAt,
      stats: await statsFor(ctx.businessId, c.offerDays, c.messages),
    })),
  );
}

export async function getCampaign(ctx: TenantContext, id: string) {
  need(ctx);
  const campaign = await db.campaign.findFirst({
    where: { id, businessId: ctx.businessId },
    include: {
      messages: {
        include: { customer: { select: { id: true, name: true, phone: true, marketingConsent: true, consentVerified: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!campaign) throw new DomainError("Campaign not found.");
  const stats = await statsFor(ctx.businessId, campaign.offerDays, campaign.messages);
  return {
    campaign,
    stats,
    // Consent is checked now, not when the message was prepared.
    messages: campaign.messages.map((m) => ({ ...m, mayMessage: canMessage(m.customer) })),
  };
}

// --- working through the list ---------------------------------------------------

/** Staff say they sent it. The offer window starts now. Refused if the customer has since withdrawn consent. */
export async function markSent(ctx: TenantContext, messageId: string) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const m = await tx.campaignMessage.findFirst({
      where: { id: messageId, businessId: ctx.businessId },
      include: { customer: { select: { marketingConsent: true, consentVerified: true } }, campaign: { select: { offerDays: true } } },
    });
    if (!m) throw new DomainError("Message not found.");
    if (m.status === "SENT") throw new DomainError("That message is already marked as sent.");
    if (!canMessage(m.customer)) throw new DomainError("This customer no longer agrees to offers. Do not send it.");
    const now = new Date();
    const res = await tx.campaignMessage.updateMany({
      where: { id: m.id, businessId: ctx.businessId, status: "QUEUED" },
      data: {
        status: "SENT",
        sentAt: now,
        sentById: ctx.userId,
        expiresAt: m.offerPoints > 0 ? new Date(now.getTime() + m.campaign.offerDays * DAY_MS) : null,
      },
    });
    if (res.count === 0) throw new DomainError("That message is already marked as sent.");
    await audit(tx, ctx, "campaign.sent", "CampaignMessage", m.id, { customerId: m.customerId });
  });
}

/** "They asked us to stop." Takes effect everywhere at once. */
export async function recordOptOut(ctx: TenantContext, messageId: string) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const m = await tx.campaignMessage.findFirst({ where: { id: messageId, businessId: ctx.businessId } });
    if (!m) throw new DomainError("Message not found.");
    await tx.customer.update({
      where: { businessId_id: { businessId: ctx.businessId, id: m.customerId } },
      data: { marketingConsent: false, consentVerified: false, consentAt: null },
    });
    await audit(tx, ctx, "campaign.optOut", "Customer", m.customerId, { campaignMessage: m.id });
  });
}

/** Names, numbers and texts for people who can be messaged right now and have not been yet. */
export async function exportQueued(ctx: TenantContext, campaignId: string) {
  need(ctx);
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, businessId: ctx.businessId }, select: { name: true } });
  if (!campaign) throw new DomainError("Campaign not found.");
  const messages = await db.campaignMessage.findMany({
    where: { campaignId, businessId: ctx.businessId, status: "QUEUED" },
    include: { customer: { select: { name: true, phone: true, marketingConsent: true, consentVerified: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    campaignName: campaign.name,
    rows: messages.filter((m) => canMessage(m.customer)).map((m) => ({ name: m.customer.name ?? "", phone: m.customer.phone, text: m.text })),
  };
}
