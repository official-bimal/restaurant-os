import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { Prisma } from "@/generated/prisma/client";
import { localDate } from "@/lib/business-day";
import { renderTemplate, segmentOf, validateTemplate } from "@/features/campaigns/segments";
import { MIN_DAYS_BETWEEN_MESSAGES } from "@/features/campaigns/server/service";
import { autoKey, inSendWindow, isBirthdayOn, isRuleKind, isValidBirthday, localHour, RULE_INFO, RULE_KINDS, type RuleKind } from "@/features/campaigns/automation";
import { getProvider } from "@/features/messaging/providers";
import { getSendStatus, sendCampaign } from "@/features/messaging/server/send";

/**
 * Automatic campaigns: a birthday offer and a win-back message, worked out once a day for each business that switched the
 * rule on. Everything here is off until an owner or manager turns a rule on, and sending by the app itself (not just
 * preparing the messages for staff) needs the owner to switch that on separately, with a messaging provider set up.
 * Each guest still has to have agreed to offers and been confirmed by staff, is never messaged twice within a week, and is
 * left alone for the rule's cool-down. Messages go out only between 9am and 8pm in the business's own time. Every query is
 * filtered by businessId.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const canMessage = (c: { marketingConsent: boolean; consentVerified: boolean }) => c.marketingConsent && c.consentVerified;

function need(ctx: TenantContext) {
  if (!can(ctx, "campaign.manage")) throw new DomainError("You do not have permission to manage campaigns.");
}

// --- the rules (staff side) ------------------------------------------------------

export interface RuleView {
  kind: RuleKind;
  enabled: boolean;
  autoSend: boolean;
  template: string;
  offerPoints: number;
  offerDays: number;
  cooldownDays: number;
  saved: boolean;
}

export async function getRules(ctx: TenantContext) {
  need(ctx);
  const stored = await db.automationRule.findMany({ where: { businessId: ctx.businessId } });
  const rules: RuleView[] = RULE_KINDS.map((kind) => {
    const r = stored.find((x) => x.kind === kind);
    const d = RULE_INFO[kind];
    return r
      ? { kind, enabled: r.enabled, autoSend: r.autoSend, template: r.template, offerPoints: r.offerPoints, offerDays: r.offerDays, cooldownDays: r.cooldownDays, saved: true }
      : { kind, enabled: false, autoSend: false, template: d.template, offerPoints: d.offerPoints, offerDays: d.offerDays, cooldownDays: d.cooldownDays, saved: false };
  });
  return { rules, provider: getProvider()?.name ?? null, canAutoSend: can(ctx, "message.send") };
}

export interface RuleInput {
  enabled: boolean;
  autoSend: boolean;
  template: string;
  offerPoints: number;
  offerDays: number;
  cooldownDays: number;
}

export async function saveRule(ctx: TenantContext, kind: string, input: RuleInput) {
  need(ctx);
  if (!isRuleKind(kind)) throw new DomainError("Unknown rule.");
  let template: string;
  try {
    template = validateTemplate(input.template);
  } catch (e) {
    throw new DomainError((e as Error).message);
  }
  if (!Number.isInteger(input.offerPoints) || input.offerPoints < 0 || input.offerPoints > 10_000) throw new DomainError("Bonus points must be a whole number from 0 to 10,000.");
  if (!Number.isInteger(input.offerDays) || input.offerDays < 1 || input.offerDays > 90) throw new DomainError("The offer must last between 1 and 90 days.");
  if (!Number.isInteger(input.cooldownDays) || input.cooldownDays < 7 || input.cooldownDays > 365) throw new DomainError("Leave at least 7 and at most 365 days before messaging the same guest again.");

  const existing = await db.automationRule.findUnique({ where: { businessId_kind: { businessId: ctx.businessId, kind } } });
  // Text that is sent without anyone looking is only changed by someone allowed to send.
  if (existing?.autoSend && !can(ctx, "message.send")) throw new DomainError("This rule sends by itself, so only the owner can change it.");
  if (input.autoSend) {
    if (!can(ctx, "message.send")) throw new DomainError("Only the owner can switch on sending by the app.");
    if (!getProvider()) throw new DomainError("Messaging is not set up on this server yet, so the app cannot send. It can still prepare the messages for you.");
  }
  const autoSend = input.enabled && input.autoSend;
  const enabledById = autoSend ? (existing?.autoSend ? (existing.enabledById ?? ctx.userId) : ctx.userId) : null;
  const data = { enabled: input.enabled, autoSend, template, offerPoints: input.offerPoints, offerDays: input.offerDays, cooldownDays: input.cooldownDays, enabledById };
  await db.$transaction(async (tx) => {
    await tx.automationRule.upsert({
      where: { businessId_kind: { businessId: ctx.businessId, kind } },
      create: { businessId: ctx.businessId, kind, ...data },
      update: data,
    });
    await audit(tx, ctx, "campaign.rule", "AutomationRule", kind, { enabled: input.enabled, autoSend, offerPoints: input.offerPoints });
  });
}

/** A guest's birthday (month and day only). Both empty clears it. */
export async function setBirthday(ctx: TenantContext, customerId: string, month: number | null, day: number | null) {
  if (!can(ctx, "customer.manage")) throw new DomainError("You do not have permission to change customers.");
  const clearing = month === null && day === null;
  if (!clearing && !isValidBirthday(month, day)) throw new DomainError("Choose a real month and day.");
  await db.$transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id: customerId, businessId: ctx.businessId } });
    if (!c) throw new DomainError("Customer not found.");
    await tx.customer.update({ where: { businessId_id: { businessId: ctx.businessId, id: customerId } }, data: { birthMonth: month, birthDay: day } });
    await audit(tx, ctx, "customer.birthday", "Customer", customerId, { set: !clearing });
  });
}

// --- who a rule would reach ---------------------------------------------------------

interface RuleRow {
  kind: string;
  template: string;
  offerPoints: number;
  offerDays: number;
  cooldownDays: number;
}

/** Guests a rule reaches on a given day: agreed and confirmed, matching the rule, not messaged lately. */
async function audienceFor(businessId: string, rule: RuleRow, date: string, now: Date) {
  const [customers, recentAny, recentSameKind] = await Promise.all([
    db.customer.findMany({ where: { businessId, marketingConsent: true, consentVerified: true } }),
    db.campaignMessage.findMany({ where: { businessId, createdAt: { gt: new Date(now.getTime() - MIN_DAYS_BETWEEN_MESSAGES * DAY_MS) } }, select: { customerId: true } }),
    db.campaignMessage.findMany({ where: { businessId, campaign: { segment: rule.kind }, createdAt: { gt: new Date(now.getTime() - rule.cooldownDays * DAY_MS) } }, select: { customerId: true } }),
  ]);
  const skip = new Set([...recentAny, ...recentSameKind].map((m) => m.customerId));
  return customers.filter((c) => {
    if (!canMessage(c) || skip.has(c.id)) return false;
    if (rule.kind === "BIRTHDAY") return isBirthdayOn(c.birthMonth, c.birthDay, date);
    if (rule.kind === "WIN_BACK") return segmentOf(c, now) === "AT_RISK";
    return false;
  });
}

/** How many guests the rule would reach right now, for the settings page. Nothing is created or sent. */
export async function previewRule(ctx: TenantContext, kind: string) {
  need(ctx);
  if (!isRuleKind(kind)) throw new DomainError("Unknown rule.");
  const { rules } = await getRules(ctx);
  const rule = rules.find((r) => r.kind === kind)!;
  const business = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const now = new Date();
  return { count: (await audienceFor(ctx.businessId, rule, localDate(now, business.timezone), now)).length };
}

// --- the daily run ---------------------------------------------------------------

export interface RunSummary {
  businessId: string;
  kind: string;
  prepared: number;
  sent: number;
  failed: number;
  note: string | null;
}

/** The owner account whose permission automatic sending runs under, or null if it is no longer valid. */
async function senderContext(businessId: string, userId: string | null) {
  if (!userId) return null;
  const m = await db.membership.findFirst({ where: { businessId, userId, role: "OWNER" } });
  if (!m) return null;
  const branches = await db.branch.findMany({ where: { businessId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (branches.length === 0) return null;
  const ctx: TenantContext = { userId, businessId, branchId: branches[0]!.id, branchIds: branches.map((b) => b.id), role: "OWNER" };
  return ctx;
}

/**
 * Work out and, where allowed, send today's automatic messages for every business with a rule switched on. Safe to run as
 * often as you like (a timer calls it every few minutes): each rule makes at most one campaign per local day, and a
 * message can never be sent twice.
 */
export async function runAutomations(now: Date = new Date()): Promise<RunSummary[]> {
  const rules = await db.automationRule.findMany({ where: { enabled: true }, include: { business: { select: { name: true, timezone: true } } } });
  const out: RunSummary[] = [];
  for (const rule of rules) {
    const businessId = rule.businessId;
    const summary: RunSummary = { businessId, kind: rule.kind, prepared: 0, sent: 0, failed: 0, note: null };
    out.push(summary);
    try {
      if (!isRuleKind(rule.kind)) {
        summary.note = "unknown rule";
        continue;
      }
      if (!inSendWindow(localHour(now, rule.business.timezone))) {
        summary.note = "outside sending hours";
        continue;
      }
      const date = localDate(now, rule.business.timezone);
      const key = autoKey(rule.kind, date);

      let campaign = await db.campaign.findUnique({ where: { businessId_autoKey: { businessId, autoKey: key } }, select: { id: true } });
      if (!campaign) {
        const audience = await audienceFor(businessId, rule, date, now);
        if (audience.length === 0) {
          summary.note = "nobody to message today";
          continue;
        }
        try {
          campaign = await db.$transaction(async (tx) => {
            const c = await tx.campaign.create({
              data: { businessId, name: `${RULE_INFO[rule.kind as RuleKind].label} · ${date}`, segment: rule.kind, template: rule.template, offerPoints: rule.offerPoints, offerDays: rule.offerDays, preparedAt: now, autoKey: key },
              select: { id: true },
            });
            await tx.campaignMessage.createMany({
              data: audience.map((cu) => ({
                businessId,
                campaignId: c.id,
                customerId: cu.id,
                text: renderTemplate(rule.template, { name: cu.name, points: rule.offerPoints, days: rule.offerDays, business: rule.business.name }),
                offerPoints: rule.offerPoints,
              })),
            });
            await tx.auditEvent.create({ data: { businessId, userId: null, action: "campaign.auto", entity: "Campaign", entityId: c.id, detail: { kind: rule.kind, date, prepared: audience.length } } });
            return c;
          });
          summary.prepared = audience.length;
        } catch (e) {
          // Another run made today's campaign a moment ago: carry on with that one.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            campaign = await db.campaign.findUnique({ where: { businessId_autoKey: { businessId, autoKey: key } }, select: { id: true } });
          } else {
            throw e;
          }
        }
      }
      if (!campaign) continue;

      if (!rule.autoSend) {
        summary.note = summary.prepared ? "prepared for staff to send" : null;
        continue;
      }
      if (!getProvider()) {
        summary.note = "no messaging provider: left for staff to send";
        continue;
      }
      const sender = await senderContext(businessId, rule.enabledById);
      if (!sender) {
        summary.note = "the owner who switched sending on is no longer available: left for staff to send";
        continue;
      }
      const status = await getSendStatus(sender, campaign.id);
      if (status.ready === 0) continue;
      const res = await sendCampaign(sender, campaign.id, status.ready);
      summary.sent = res.sent;
      summary.failed = res.failed;
      if (res.failed) summary.note = res.firstError;
    } catch (e) {
      summary.note = e instanceof DomainError ? e.message : "unexpected error";
      if (!(e instanceof DomainError)) console.error("automation failed", rule.kind, e);
    }
  }
  return out;
}
