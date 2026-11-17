import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { normalizePhone } from "@/server/phone";
import { dayRange, localDate } from "@/lib/business-day";
import { getBranchRollup } from "@/features/reports/server/service";
import { pushToTeam } from "@/features/notifications/server/push";
import { getProvider } from "@/features/messaging/providers";
import { getEmailProvider, looksLikeEmail } from "@/features/owner/email";
import { evaluateRules, DEFAULT_THRESHOLDS, type Candidate, type DayFacts, type Thresholds } from "@/features/owner/rules";
import { fullSummary, shortSummary, type SummaryData } from "@/features/owner/summary";

/**
 * Owner control: the daily summary, the suspicious-activity alerts and their thresholds. Only people with owner.control
 * (the owner) can see or change any of it. Every query is filtered by businessId. Nothing is sent anywhere unless the owner
 * switched a channel on, and sending a summary by text or email needs a provider on the server (the same kind of setup as
 * campaign messages).
 */

function need(ctx: TenantContext) {
  if (!can(ctx.role, "owner.control")) throw new DomainError("Only the owner can use owner controls.");
}

// --- settings -----------------------------------------------------------------------

export interface OwnerConfig extends Thresholds {
  summaryEnabled: boolean;
  summaryHour: number;
  channelPush: boolean;
  smsPhone: string | null;
  email: string | null;
  alertsEnabled: boolean;
  lastSummaryDate: string | null;
}

const DEFAULTS: OwnerConfig = { ...DEFAULT_THRESHOLDS, summaryEnabled: false, summaryHour: 22, channelPush: true, smsPhone: null, email: null, alertsEnabled: true, lastSummaryDate: null };

async function configFor(businessId: string): Promise<OwnerConfig> {
  const r = await db.ownerSetting.findUnique({ where: { businessId } });
  if (!r) return { ...DEFAULTS };
  return {
    summaryEnabled: r.summaryEnabled,
    summaryHour: r.summaryHour,
    channelPush: r.channelPush,
    smsPhone: r.smsPhone,
    email: r.email,
    alertsEnabled: r.alertsEnabled,
    lastSummaryDate: r.lastSummaryDate,
    alertVoidCount: r.alertVoidCount,
    alertVoidAmount: r.alertVoidAmount,
    alertDiscountPct: r.alertDiscountPct,
    alertDiscountShareBps: r.alertDiscountShareBps,
    alertRefundAmount: r.alertRefundAmount,
    alertCashDiff: r.alertCashDiff,
  };
}

export async function getOwnerSettings(ctx: TenantContext) {
  need(ctx);
  return {
    config: await configFor(ctx.businessId),
    smsProvider: getProvider()?.name ?? null,
    emailProvider: getEmailProvider()?.name ?? null,
  };
}

export interface OwnerConfigInput {
  summaryEnabled: boolean;
  summaryHour: number;
  channelPush: boolean;
  smsPhone: string;
  email: string;
  alertsEnabled: boolean;
  alertVoidCount: number;
  /** Paisa. */
  alertVoidAmount: number;
  alertDiscountPct: number;
  alertDiscountSharePct: number;
  alertRefundAmount: number;
  alertCashDiff: number;
}

export async function saveOwnerSettings(ctx: TenantContext, input: OwnerConfigInput) {
  need(ctx);
  if (!Number.isInteger(input.summaryHour) || input.summaryHour < 0 || input.summaryHour > 23) throw new DomainError("Choose an hour from 0 to 23.");
  const int = (v: number, lo: number, hi: number, what: string) => {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new DomainError(`${what} must be a whole number from ${lo} to ${hi.toLocaleString("en-US")} (0 switches it off).`);
    return v;
  };
  const data = {
    summaryEnabled: input.summaryEnabled,
    summaryHour: input.summaryHour,
    channelPush: input.channelPush,
    smsPhone: null as string | null,
    email: null as string | null,
    alertsEnabled: input.alertsEnabled,
    alertVoidCount: int(input.alertVoidCount, 0, 1000, "Cancelled bills"),
    alertVoidAmount: int(input.alertVoidAmount, 0, 100_000_000_00, "Cancelled value"),
    alertDiscountPct: int(input.alertDiscountPct, 0, 100, "Discount percent"),
    alertDiscountShareBps: int(Math.round(input.alertDiscountSharePct * 100), 0, 10_000, "Discount share"),
    alertRefundAmount: int(input.alertRefundAmount, 0, 100_000_000_00, "Refund amount"),
    alertCashDiff: int(input.alertCashDiff, 0, 100_000_000_00, "Cash difference"),
  };
  if (input.smsPhone.trim()) data.smsPhone = normalizePhone(input.smsPhone);
  const email = input.email.trim();
  if (email) {
    if (!looksLikeEmail(email)) throw new DomainError("Enter a full email address.");
    data.email = email;
  }
  await db.$transaction(async (tx) => {
    await tx.ownerSetting.upsert({ where: { businessId: ctx.businessId }, create: { businessId: ctx.businessId, ...data }, update: data });
    await audit(tx, ctx, "owner.settings", "Business", ctx.businessId, { summary: data.summaryEnabled, alerts: data.alertsEnabled });
  });
}

// --- facts and summary --------------------------------------------------------------

/** The system's own identity for working out figures: the whole business, never a signed-in person. */
async function systemCtx(businessId: string): Promise<TenantContext> {
  const branches = await db.branch.findMany({ where: { businessId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (branches.length === 0) throw new DomainError("This business has no active branch.");
  return { userId: "owner-checks", businessId, branchId: branches[0]!.id, branchIds: branches.map((b) => b.id), role: "OWNER" };
}

export async function getDayFacts(businessId: string, date: string, timezone: string): Promise<DayFacts> {
  const { start, end } = { start: dayRange(date, timezone).start, end: dayRange(date, timezone).end };
  const inDay = { gte: start, lt: end };
  const [voidItems, invoices, notes, closes] = await Promise.all([
    db.orderItem.findMany({
      where: { businessId, complimentary: false, cancelReason: { startsWith: "Order cancelled" }, order: { status: "CANCELLED", closedAt: inDay } },
      select: { orderId: true, unitPrice: true, quantity: true },
    }),
    db.invoice.findMany({ where: { businessId, createdAt: inDay }, select: { id: true, number: true, subtotal: true, discount: true } }),
    db.creditNote.findMany({ where: { businessId, createdAt: inDay }, select: { id: true, number: true, grandTotal: true, partial: true, invoice: { select: { number: true } } } }),
    db.dayClose.findMany({ where: { businessId, date }, select: { difference: true, branch: { select: { name: true } } } }),
  ]);
  return {
    date,
    voids: { count: new Set(voidItems.map((i) => i.orderId)).size, amount: voidItems.reduce((n, i) => n + i.unitPrice * i.quantity, 0) },
    invoices,
    refunds: notes.map((n) => ({ id: n.id, number: n.number, invoiceNumber: n.invoice.number, amount: n.grandTotal, partial: n.partial })),
    cashDiffs: closes.map((c) => ({ branch: c.branch.name, difference: c.difference })),
  };
}

export async function buildSummary(businessId: string, date: string) {
  const [business, cfg] = await Promise.all([db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, timezone: true } }), configFor(businessId)]);
  const sys = await systemCtx(businessId);
  const [roll, facts, entries, team, stored] = await Promise.all([
    getBranchRollup(sys, { from: date, to: date }),
    getDayFacts(businessId, date, business.timezone),
    db.timeEntry.findMany({ where: { businessId, clockIn: { gte: dayRange(date, business.timezone).start, lt: dayRange(date, business.timezone).end } }, include: { user: { select: { id: true, name: true } } } }),
    db.membership.findMany({ where: { businessId, role: { not: "RIDER" } }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    db.ownerAlert.findMany({ where: { businessId, date }, orderBy: { createdAt: "asc" }, select: { title: true } }),
  ]);
  const c = roll.combined;
  const now = Date.now();
  const mins = new Map<string, { name: string; minutes: number; stillIn: boolean }>();
  for (const e of entries) {
    const m = Math.max(0, Math.round(((e.clockOut ?? new Date(now)).getTime() - e.clockIn.getTime()) / 60_000));
    const cur = mins.get(e.userId) ?? { name: e.user.name, minutes: 0, stillIn: false };
    cur.minutes += m;
    cur.stillIn = cur.stillIn || !e.clockOut;
    mins.set(e.userId, cur);
  }
  const data: SummaryData = {
    business: business.name,
    dateLabel: new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
    branches: roll.branches.map((b) => b.name),
    sales: { count: c.sales.count, gross: c.sales.gross, average: c.sales.average, discount: c.sales.discount, vat: c.sales.vat },
    refunds: { count: c.refunds.count, total: c.refunds.total },
    net: c.net,
    byMethod: { cash: c.byMethod.CASH.net, qr: c.byMethod.QR.net, card: c.byMethod.CARD.net, credit: c.byMethod.CREDIT.net },
    cancelled: facts.voids,
    cash: facts.cashDiffs,
    foodCost: c.foodCost,
    topItems: c.topItems.slice(0, 3).map((t) => ({ name: t.name, quantity: t.quantity })),
    staff: [...mins.values()],
    staffOff: team.filter((m) => !mins.has(m.user.id)).map((m) => m.user.name),
    alerts: stored,
  };
  return { data, facts, candidates: evaluateRules(facts, cfg), short: shortSummary(data), full: fullSummary(data) };
}

// --- alerts -----------------------------------------------------------------------------

/** Store any alert the rules find for today that is not already stored. Returns the new ones. */
async function recordAlerts(businessId: string, date: string, candidates: Candidate[]): Promise<Candidate[]> {
  const fresh: Candidate[] = [];
  for (const c of candidates) {
    // skipDuplicates (instead of catching a unique-key error) keeps the database connection healthy when an alert already exists.
    const made = await db.ownerAlert.createMany({ data: [{ businessId, kind: c.kind, date, key: c.key, title: c.title, detail: c.detail, level: c.level }], skipDuplicates: true });
    if (made.count === 1) fresh.push(c);
  }
  return fresh;
}

export async function listAlerts(ctx: TenantContext, take = 60) {
  need(ctx);
  return db.ownerAlert.findMany({ where: { businessId: ctx.businessId }, orderBy: { createdAt: "desc" }, take });
}

export async function unseenAlertCount(ctx: TenantContext): Promise<number> {
  if (!can(ctx.role, "owner.control")) return 0;
  return db.ownerAlert.count({ where: { businessId: ctx.businessId, seenAt: null } });
}

export async function markAlertsSeen(ctx: TenantContext) {
  need(ctx);
  await db.ownerAlert.updateMany({ where: { businessId: ctx.businessId, seenAt: null }, data: { seenAt: new Date() } });
}

// --- sending ---------------------------------------------------------------------------

export interface SendReport {
  push: "sent" | "off" | "none" | string;
  sms: "sent" | "off" | string;
  email: "sent" | "off" | string;
}

/** Send a summary through the channels the owner switched on. Each channel reports on its own; one failing does not stop the others. */
export async function deliverSummary(businessId: string, date: string, cfg?: OwnerConfig): Promise<SendReport> {
  const config = cfg ?? (await configFor(businessId));
  const s = await buildSummary(businessId, date);
  const report: SendReport = { push: "off", sms: "off", email: "off" };
  if (config.channelPush) {
    const n = await pushToTeam({ businessId, permission: "owner.control", payload: { title: `Daily summary · ${s.data.dateLabel}`, body: s.short, url: "/owner", tag: `summary-${date}` } });
    report.push = n > 0 ? "sent" : "none";
  }
  if (config.smsPhone) {
    const provider = getProvider();
    if (!provider) report.sms = "no text-message provider on this server";
    else {
      const r = await provider.send(config.smsPhone, s.short);
      report.sms = r.ok ? "sent" : r.error;
    }
  }
  if (config.email) {
    const provider = getEmailProvider();
    if (!provider) report.email = "no email service on this server";
    else {
      const r = await provider.send(config.email, `${s.data.business}: daily summary, ${s.data.dateLabel}`, s.full.join("\n"));
      report.email = r.ok ? "sent" : r.error;
    }
  }
  return report;
}

/** The owner presses "Send me today's summary now". */
export async function sendSummaryNow(ctx: TenantContext): Promise<SendReport> {
  need(ctx);
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const date = localDate(new Date(), timezone);
  const report = await deliverSummary(ctx.businessId, date);
  await db.$transaction((tx) => audit(tx, ctx, "owner.summarySent", "Business", ctx.businessId, { date, ...report }));
  return report;
}

// --- the periodic check -------------------------------------------------------------------

const localHourOf = (now: Date, tz: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now)) % 24;

export interface OwnerRunSummary {
  businessId: string;
  newAlerts: number;
  summarySent: boolean;
}

/**
 * Look at every business that switched alerts or the daily summary on: store and announce any new alert for today, and send the
 * daily summary once the chosen hour has passed. Safe to run as often as you like: an alert is stored once, a summary is sent
 * once a day, and alerts are announced by push only between 7am and 10pm local time.
 */
export async function runOwnerChecks(now: Date = new Date()): Promise<OwnerRunSummary[]> {
  const settings = await db.ownerSetting.findMany({ where: { OR: [{ alertsEnabled: true }, { summaryEnabled: true }] } });
  const out: OwnerRunSummary[] = [];
  for (const row of settings) {
    const run: OwnerRunSummary = { businessId: row.businessId, newAlerts: 0, summarySent: false };
    out.push(run);
    try {
      const business = await db.business.findUnique({ where: { id: row.businessId }, select: { timezone: true } });
      if (!business) continue;
      const cfg = await configFor(row.businessId);
      const date = localDate(now, business.timezone);
      const hour = localHourOf(now, business.timezone);

      if (cfg.alertsEnabled) {
        const facts = await getDayFacts(row.businessId, date, business.timezone);
        const fresh = await recordAlerts(row.businessId, date, evaluateRules(facts, cfg));
        run.newAlerts = fresh.length;
        if (fresh.length > 0 && cfg.channelPush && hour >= 7 && hour < 22) {
          for (const c of fresh.slice(0, 5)) {
            await pushToTeam({ businessId: row.businessId, permission: "owner.control", payload: { title: c.title, body: c.detail, url: "/owner", tag: `alert-${c.kind}-${c.key}` } });
          }
        }
      }
      if (cfg.summaryEnabled && hour >= cfg.summaryHour && cfg.lastSummaryDate !== date) {
        // Mark the day first so a slow provider cannot make the next check send it a second time.
        const claimed = await db.ownerSetting.updateMany({ where: { businessId: row.businessId, OR: [{ lastSummaryDate: null }, { lastSummaryDate: { not: date } }] }, data: { lastSummaryDate: date } });
        if (claimed.count === 1) {
          await deliverSummary(row.businessId, date, cfg);
          run.summarySent = true;
        }
      }
    } catch (e) {
      console.error("owner check failed", row.businessId, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
