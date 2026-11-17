import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { maskPhone } from "@/server/phone";
import { dailyLimit, getProvider } from "../providers";

/**
 * Sending a campaign's prepared messages through the chosen provider.
 *
 * Nothing is sent unless (1) a provider is configured, (2) the person has the message.send permission, and (3) they confirm
 * the exact number of messages they were shown. Each message re-checks the customer's consent at the moment of sending.
 * A MessageLog row is claimed BEFORE the provider is called, so a double click, a second device or a retry after a crash can
 * never send the same person the same campaign twice (a message stuck "in progress" is left alone rather than risk a repeat).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const IN_PROGRESS = "sending";

const canMessage = (c: { marketingConsent: boolean; consentVerified: boolean }) => c.marketingConsent && c.consentVerified;

function needSend(ctx: TenantContext) {
  if (!can(ctx.role, "message.send") || !can(ctx.role, "campaign.manage")) throw new DomainError("You do not have permission to send messages.");
}

/** What the campaign page needs to decide whether to show a Send button. */
export async function getSendStatus(ctx: TenantContext, campaignId: string) {
  const provider = getProvider();
  const allowed = can(ctx.role, "message.send");
  if (!provider || !allowed) return { provider: provider?.name ?? null, allowed, ready: 0, remainingToday: 0 };
  const [messages, used] = await Promise.all([
    db.campaignMessage.findMany({
      where: { campaignId, businessId: ctx.businessId, status: "QUEUED" },
      include: { customer: { select: { phone: true, marketingConsent: true, consentVerified: true } } },
    }),
    db.messageLog.count({ where: { businessId: ctx.businessId, createdAt: { gt: new Date(Date.now() - DAY_MS) } } }),
  ]);
  const ready = messages.filter((m) => canMessage(m.customer) && m.customer.phone).length;
  const remainingToday = Math.max(0, dailyLimit() - used);
  return { provider: provider.name, allowed, ready: Math.min(ready, remainingToday), remainingToday };
}

export interface SendSummary {
  sent: number;
  failed: number;
  skipped: number;
  /** Left for tomorrow because of the daily limit. */
  deferred: number;
  firstError: string | null;
}

export async function sendCampaign(ctx: TenantContext, campaignId: string, expected: number): Promise<SendSummary> {
  needSend(ctx);
  const provider = getProvider();
  if (!provider) throw new DomainError("Messaging is not set up. Choose a provider in the server settings, or send by hand.");

  const campaign = await db.campaign.findFirst({ where: { id: campaignId, businessId: ctx.businessId }, select: { id: true, offerDays: true, preparedAt: true } });
  if (!campaign) throw new DomainError("Campaign not found.");
  if (!campaign.preparedAt) throw new DomainError("Prepare the messages first.");

  const queued = await db.campaignMessage.findMany({
    where: { campaignId, businessId: ctx.businessId, status: "QUEUED" },
    include: { customer: { select: { phone: true, marketingConsent: true, consentVerified: true } } },
    orderBy: { createdAt: "asc" },
  });
  const eligible = queued.filter((m) => canMessage(m.customer) && m.customer.phone);
  const skipped = queued.length - eligible.length;

  const used = await db.messageLog.count({ where: { businessId: ctx.businessId, createdAt: { gt: new Date(Date.now() - DAY_MS) } } });
  const room = Math.max(0, dailyLimit() - used);
  const batch = eligible.slice(0, room);

  if (!Number.isInteger(expected) || expected !== batch.length) {
    throw new DomainError(`The list changed: ${batch.length} message${batch.length === 1 ? "" : "s"} can be sent now, not ${expected}. Check the page and confirm again.`);
  }
  if (batch.length === 0) throw new DomainError(room === 0 ? "The daily sending limit has been reached. Try again tomorrow." : "There is nothing to send.");

  let sent = 0;
  let failed = 0;
  let firstError: string | null = null;

  for (const m of batch) {
    // Consent can change while a long list is being sent: look again right before each one.
    const fresh = await db.customer.findFirst({
      where: { id: m.customerId, businessId: ctx.businessId },
      select: { phone: true, marketingConsent: true, consentVerified: true },
    });
    if (!fresh || !fresh.phone || !canMessage(fresh)) continue;

    // Claim this person for this campaign. Only a brand-new row, or an earlier failed one, may be claimed.
    const created = await db.messageLog.createMany({
      data: [{ businessId: ctx.businessId, campaignId, customerId: m.customerId, phoneMasked: maskPhone(fresh.phone), status: "SKIPPED", error: IN_PROGRESS, createdById: ctx.userId }],
      skipDuplicates: true,
    });
    let claimed = created.count === 1;
    if (!claimed) {
      const retry = await db.messageLog.updateMany({
        where: { campaignId, customerId: m.customerId, businessId: ctx.businessId, status: "FAILED" },
        data: { status: "SKIPPED", error: IN_PROGRESS, createdById: ctx.userId },
      });
      claimed = retry.count === 1;
    }
    if (!claimed) continue;

    const result = await provider.send(fresh.phone, m.text);
    if (result.ok) {
      const now = new Date();
      await db.$transaction([
        db.messageLog.updateMany({
          where: { campaignId, customerId: m.customerId, businessId: ctx.businessId },
          data: { status: "SENT", providerRef: result.ref ?? null, error: null },
        }),
        db.campaignMessage.updateMany({
          where: { id: m.id, businessId: ctx.businessId, status: "QUEUED" },
          data: { status: "SENT", sentAt: now, sentById: ctx.userId, expiresAt: m.offerPoints > 0 ? new Date(now.getTime() + campaign.offerDays * DAY_MS) : null },
        }),
      ]);
      sent += 1;
    } else {
      await db.messageLog.updateMany({
        where: { campaignId, customerId: m.customerId, businessId: ctx.businessId },
        data: { status: "FAILED", error: result.error.slice(0, 200) },
      });
      failed += 1;
      firstError ??= result.error;
    }
  }

  await db.$transaction(async (tx) => {
    await audit(tx, ctx, "campaign.send", "Campaign", campaignId, { provider: provider.name, sent, failed, skipped });
  });
  return { sent, failed, skipped, deferred: eligible.length - batch.length, firstError };
}

/** Recent send attempts for a campaign (numbers are masked). */
export async function listSendLog(ctx: TenantContext, campaignId: string) {
  needSend(ctx);
  return db.messageLog.findMany({
    where: { campaignId, businessId: ctx.businessId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, phoneMasked: true, status: true, error: true, createdAt: true },
  });
}
