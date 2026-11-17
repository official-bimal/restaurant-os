import { db } from "@/server/db";
import type { Tx } from "@/server/audit";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { cosLookup, cosRecordPurchase, type CosBalance, type FetchLike } from "../client";
import { loadTarget } from "./link";

/**
 * Sends each paid bill to Customer OS as a purchase, so Customer OS can give the points.
 *
 * The bill and its event are written in ONE transaction (enqueue), so a paid bill always has its event. Sending happens
 * afterwards and any number of times safely: Customer OS records one purchase per invoice id. A Customer OS outage, a wrong
 * key or no internet never stops billing; the events wait and are retried with growing gaps, and the owner sees them.
 */

const BATCH = 25;
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 40;
const SHOW_ERROR = 300;

/** Inside the checkout / offline-sync transaction. Does nothing unless the business is connected and the bill has a customer. */
export async function enqueueIfLinked(tx: Tx, p: { businessId: string; invoiceId: string; customerId: string | null }): Promise<boolean> {
  if (!p.customerId) return false;
  const link = await tx.customerOsLink.findUnique({ where: { businessId: p.businessId }, select: { businessId: true } });
  if (!link) return false;
  await tx.customerOsEvent.createMany({ data: [{ businessId: p.businessId, invoiceId: p.invoiceId }], skipDuplicates: true });
  return true;
}

const backoffMs = (attempts: number) => Math.min(2 ** Math.min(attempts, 10), 60) * 60_000;

export interface FlushReport {
  sent: number;
  waiting: number;
  failed: number;
}

/** Sends this business's due events, oldest first. Safe to run from several places at once: each event is leased first. */
export async function flushBusiness(businessId: string, opts: { fetchImpl?: FetchLike; now?: Date } = {}): Promise<FlushReport> {
  const report: FlushReport = { sent: 0, waiting: 0, failed: 0 };
  const loaded = await loadTarget(businessId);
  if (!loaded || !loaded.enabled) return report;
  const now = opts.now ?? new Date();

  const due = await db.customerOsEvent.findMany({
    where: { businessId, status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: { id: true, invoiceId: true, attempts: true },
  });
  for (const ev of due) {
    // Lease: only one runner gets each event; if it dies mid-send the lease simply expires and the event is retried.
    const lease = await db.customerOsEvent.updateMany({
      where: { id: ev.id, status: "PENDING", nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (lease.count === 0) continue;
    const attempts = ev.attempts + 1;

    const invoice = await db.invoice.findFirst({
      where: { id: ev.invoiceId, businessId },
      select: { id: true, grandTotal: true, deliveryFee: true, createdAt: true, customer: { select: { phone: true, name: true } } },
    });
    if (!invoice || !invoice.customer) {
      await db.customerOsEvent.update({ where: { id: ev.id }, data: { status: "FAILED", lastError: "The bill or its customer is no longer here." } });
      report.failed++;
      continue;
    }
    // Same basis as this app's own points: the food and drink, not the delivery fee.
    const amountMinor = invoice.grandTotal - invoice.deliveryFee;
    if (amountMinor <= 0) {
      await db.customerOsEvent.update({ where: { id: ev.id }, data: { status: "SENT", sentAt: now, pointsEarned: 0, lastError: "Nothing to count on this bill." } });
      continue;
    }

    const res = await cosRecordPurchase(
      loaded.target,
      { externalId: invoice.id, phone: invoice.customer.phone, name: invoice.customer.name ?? undefined, amountMinor, occurredAt: invoice.createdAt.toISOString() },
      { fetchImpl: opts.fetchImpl },
    );
    if (res.ok) {
      await db.customerOsEvent.update({ where: { id: ev.id }, data: { status: "SENT", sentAt: new Date(), pointsEarned: res.data.pointsEarned, lastError: null } });
      await db.customerOsLink.updateMany({ where: { businessId }, data: { lastOkAt: new Date(), lastError: null } });
      report.sent++;
      continue;
    }
    const message = res.status === 401 ? "Customer OS did not accept the key. Enter a new key." : res.message;
    const giveUp = !res.retry || attempts >= MAX_ATTEMPTS;
    await db.customerOsEvent.update({
      where: { id: ev.id },
      data: giveUp
        ? { status: "FAILED", lastError: message.slice(0, SHOW_ERROR) }
        : { nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), lastError: message.slice(0, SHOW_ERROR) },
    });
    await db.customerOsLink.updateMany({ where: { businessId }, data: { lastError: message.slice(0, SHOW_ERROR) } });
    if (giveUp) report.failed++;
    else report.waiting++;
    // A wrong key or an unreachable server fails every remaining event the same way: stop and try again on the next round.
    if (res.status === 401 || res.status === 0) break;
  }
  return report;
}

/** Every connected business. Called by the 15-minute timer. */
export async function flushAll(opts: { fetchImpl?: FetchLike } = {}): Promise<Record<string, FlushReport>> {
  const links = await db.customerOsLink.findMany({ where: { enabled: true }, select: { businessId: true } });
  const out: Record<string, FlushReport> = {};
  for (const l of links) {
    const r = await flushBusiness(l.businessId, opts);
    if (r.sent || r.waiting || r.failed) out[l.businessId] = r;
  }
  return out;
}

/** After a bill is saved: try now, in the background, without ever delaying or failing the sale. */
export function flushSoon(businessId: string): void {
  void flushBusiness(businessId).catch((e) => console.error("[customeros] send failed", e instanceof Error ? e.message : e));
}

/** Failed events go back in the queue (the owner pressed "Try again"). */
export async function retryFailed(ctx: TenantContext): Promise<number> {
  if (!can(ctx.role, "owner.control")) throw new DomainError("Only the owner can do that.");
  const r = await db.customerOsEvent.updateMany({
    where: { businessId: ctx.businessId, status: "FAILED" },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
  return r.count;
}

// ---------- reading the balance back ----------

export type BalanceView =
  | { state: "off" }
  | { state: "unavailable" }
  | { state: "ok"; balance: CosBalance };

const CACHE_MS = 20_000;
const cache = (globalThis as unknown as { __rosCosCache?: Map<string, { at: number; value: CosBalance }> }).__rosCosCache ?? new Map();
(globalThis as unknown as { __rosCosCache?: unknown }).__rosCosCache = cache;

/**
 * A customer's points as Customer OS holds them. Never throws and never blocks a page for long: if Customer OS is slow or
 * down the page shows "unavailable" instead. Short cache so a page refresh does not call out every time.
 */
export async function lookupBalance(ctx: TenantContext, customerId: string, opts: { fetchImpl?: FetchLike } = {}): Promise<BalanceView> {
  const loaded = await loadTarget(ctx.businessId);
  if (!loaded || !loaded.enabled) return { state: "off" };
  const customer = await db.customer.findFirst({ where: { id: customerId, businessId: ctx.businessId }, select: { phone: true } });
  if (!customer) return { state: "unavailable" };
  const ck = `${ctx.businessId}:${customer.phone}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_MS && !opts.fetchImpl) return { state: "ok", balance: hit.value };
  const res = await cosLookup(loaded.target, customer.phone, { fetchImpl: opts.fetchImpl });
  if (!res.ok) return { state: "unavailable" };
  cache.set(ck, { at: Date.now(), value: res.data });
  if (cache.size > 500) cache.clear();
  return { state: "ok", balance: res.data };
}
