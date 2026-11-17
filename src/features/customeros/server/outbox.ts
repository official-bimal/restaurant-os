import { db } from "@/server/db";
import type { Tx } from "@/server/audit";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { cosLookup, cosRecordPurchase, cosRefund, cosRelease, type CosBalance, type CosResult, type CosTarget, type FetchLike } from "../client";
import { loadTarget } from "./link";

/**
 * Tells Customer OS about each paid bill (so it gives the points), each refund (so it takes them back) and, when a reward was
 * used on a bill that was then not paid, that the points must be given back.
 *
 * Events are written in the SAME transaction as the invoice or credit note, so a paid bill always has its event. Sending
 * happens afterwards and any number of times safely: Customer OS keys every call to the bill or credit note id. A Customer OS
 * outage, a wrong key or no internet never stops billing; events wait and are retried with growing gaps, and the owner sees them.
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
  await tx.customerOsEvent.createMany({ data: [{ businessId: p.businessId, kind: "PURCHASE", invoiceId: p.invoiceId, refId: p.invoiceId }], skipDuplicates: true });
  return true;
}

/**
 * Inside the refund transaction. Only a bill that was (or will be) recorded in Customer OS can have its points taken back:
 * a bill paid before the connection existed has nothing there to reverse.
 */
export async function enqueueRefundIfLinked(tx: Tx, p: { businessId: string; invoiceId: string; creditNoteId: string }): Promise<boolean> {
  const sale = await tx.customerOsEvent.findUnique({ where: { businessId_kind_refId: { businessId: p.businessId, kind: "PURCHASE", refId: p.invoiceId } }, select: { id: true } });
  if (!sale) return false;
  await tx.customerOsEvent.createMany({ data: [{ businessId: p.businessId, kind: "REFUND", invoiceId: p.invoiceId, refId: p.creditNoteId }], skipDuplicates: true });
  return true;
}

/** A reward was used on a bill and the bill is paid: kept for the record (it already reached Customer OS before the bill was paid). */
export async function recordRedeemed(tx: Tx, p: { businessId: string; orderId: string; externalId: string; consumed: number }): Promise<void> {
  await tx.customerOsEvent.createMany({
    data: [{ businessId: p.businessId, kind: "REDEEM", invoiceId: p.orderId, refId: p.externalId, status: "SENT", sentAt: new Date(), pointsEarned: p.consumed }],
    skipDuplicates: true,
  });
}

/**
 * A reward was used (or may have been) but the bill could not be paid, and giving the points back right away failed: keep trying.
 * `delayMs` gives a cashier who is retrying the same bill time to finish it first; a redemption that ended up on a paid bill is
 * never released (see perform).
 */
export async function enqueueRelease(businessId: string, orderId: string, externalId: string, delayMs = 2 * 60_000): Promise<void> {
  await db.customerOsEvent.createMany({
    data: [{ businessId, kind: "RELEASE", invoiceId: orderId, refId: externalId, nextAttemptAt: new Date(Date.now() + delayMs) }],
    skipDuplicates: true,
  });
}

const backoffMs = (attempts: number) => Math.min(2 ** Math.min(attempts, 10), 60) * 60_000;

export interface FlushReport {
  sent: number;
  waiting: number;
  failed: number;
}

type Outcome = { done: true; points: number | null; note?: string } | { done: false; wait: true } | { done: false; wait: false; failure: Extract<CosResult<unknown>, { ok: false }> | { retry: false; status: number; message: string } };

/** What one event asks of Customer OS. Pure reads here; the caller records the outcome. */
async function perform(ev: { kind: string; invoiceId: string; refId: string }, businessId: string, target: CosTarget, fetchImpl?: FetchLike): Promise<Outcome> {
  if (ev.kind === "RELEASE") {
    // A reward that ended up on a paid bill stays used. The bill's own transaction recorded that.
    const used = await db.customerOsEvent.findUnique({ where: { businessId_kind_refId: { businessId, kind: "REDEEM", refId: ev.refId } }, select: { id: true } });
    if (used) return { done: true, points: null, note: "The reward was used on a paid bill." };
    const r = await cosRelease(target, { externalId: ev.refId }, { fetchImpl });
    if (r.ok) return { done: true, points: r.data.balance };
    // "No reward was used on that sale": there is nothing to give back.
    if (r.status === 404) return { done: true, points: null, note: "Nothing to give back." };
    return { done: false, wait: false, failure: r };
  }

  const invoice = await db.invoice.findFirst({
    where: { id: ev.invoiceId, businessId },
    select: {
      id: true,
      grandTotal: true,
      deliveryFee: true,
      createdAt: true,
      customer: { select: { phone: true, name: true } },
      creditNotes: { orderBy: { number: "asc" }, select: { id: true, grandTotal: true, partial: true } },
    },
  });
  if (!invoice || !invoice.customer) return { done: false, wait: false, failure: { retry: false, status: 0, message: "The bill or its customer is no longer here." } };
  // Same basis as this app's own points used to be: the food and drink, not the delivery fee.
  const food = invoice.grandTotal - invoice.deliveryFee;

  if (ev.kind === "PURCHASE") {
    if (food <= 0) return { done: true, points: 0, note: "Nothing to count on this bill." };
    const r = await cosRecordPurchase(
      target,
      { externalId: invoice.id, phone: invoice.customer.phone, name: invoice.customer.name ?? undefined, amountMinor: food, occurredAt: invoice.createdAt.toISOString() },
      { fetchImpl },
    );
    return r.ok ? { done: true, points: r.data.pointsEarned } : { done: false, wait: false, failure: r };
  }

  // REFUND: the sale must have reached Customer OS first.
  const sale = await db.customerOsEvent.findUnique({ where: { businessId_kind_refId: { businessId, kind: "PURCHASE", refId: invoice.id } }, select: { status: true } });
  if (!sale || sale.status === "PENDING") return { done: false, wait: true };
  if (sale.status === "FAILED") return { done: false, wait: false, failure: { retry: false, status: 0, message: "The sale itself was never recorded in Customer OS, so there are no points to take back." } };
  const share = refundShare(invoice.grandTotal, food, invoice.creditNotes, ev.refId);
  if (share === null) return { done: false, wait: false, failure: { retry: false, status: 0, message: "That credit note is no longer here." } };
  if (share <= 0) return { done: true, points: 0, note: "Nothing to count on this refund." };
  const r = await cosRefund(target, { saleExternalId: invoice.id, externalRefundId: ev.refId, amountMinor: share }, { fetchImpl });
  return r.ok ? { done: true, points: r.data.pointsReversed, note: r.data.pointsShortfall > 0 ? `${r.data.pointsShortfall} points could not be taken back: already spent.` : undefined } : { done: false, wait: false, failure: r };
}

/**
 * The part of a refund that counts as food, in the same terms as the recorded purchase. Each note takes its proportional share; the
 * note that finishes the refund (not partial) takes exactly what is left, so the shares always add up to the food total.
 */
export function refundShare(grandTotal: number, food: number, notes: { id: string; grandTotal: number; partial: boolean }[], noteId: string): number | null {
  if (food <= 0 || grandTotal <= 0) return 0;
  let counted = 0;
  for (const n of notes) {
    const share = n.partial ? Math.round((n.grandTotal * food) / grandTotal) : Math.max(0, food - counted);
    if (n.id === noteId) return share;
    counted += share;
  }
  return null;
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
    select: { id: true, kind: true, invoiceId: true, refId: true, attempts: true },
  });
  for (const ev of due) {
    // Lease: only one runner gets each event; if it dies mid-send the lease simply expires and the event is retried.
    const lease = await db.customerOsEvent.updateMany({
      where: { id: ev.id, status: "PENDING", nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (lease.count === 0) continue;
    const attempts = ev.attempts + 1;

    const out = await perform(ev, businessId, loaded.target, opts.fetchImpl);
    if (out.done) {
      await db.customerOsEvent.update({ where: { id: ev.id }, data: { status: "SENT", sentAt: new Date(), pointsEarned: out.points, lastError: out.note ?? null } });
      await db.customerOsLink.updateMany({ where: { businessId }, data: { lastOkAt: new Date(), lastError: null } });
      report.sent++;
      continue;
    }
    if (out.wait) {
      // Its sale has not reached Customer OS yet. Not a failure, and not an attempt used up: look again next round.
      await db.customerOsEvent.update({ where: { id: ev.id }, data: { nextAttemptAt: new Date(now.getTime() + 60_000), attempts: ev.attempts } });
      report.waiting++;
      continue;
    }
    const f = out.failure;
    const message = f.status === 401 ? "Customer OS did not accept the key. Enter a new key." : f.message;
    const giveUp = !f.retry || attempts >= MAX_ATTEMPTS;
    await db.customerOsEvent.update({
      where: { id: ev.id },
      data: giveUp ? { status: "FAILED", lastError: message.slice(0, SHOW_ERROR) } : { nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), lastError: message.slice(0, SHOW_ERROR) },
    });
    await db.customerOsLink.updateMany({ where: { businessId }, data: { lastError: message.slice(0, SHOW_ERROR) } });
    if (giveUp) report.failed++;
    else report.waiting++;
    // A wrong key or an unreachable server fails every remaining event the same way: stop and try again on the next round.
    if (f.status === 401 || (f.status === 0 && f.retry)) break;
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
  const run = flushBusiness(businessId)
    .then(() => undefined)
    .catch((e) => console.error("[customeros] send failed", e instanceof Error ? e.message : e))
    .finally(() => background.delete(run));
  background.add(run);
}

const background = new Set<Promise<void>>();

/** Waits for sends started by flushSoon to finish (tests, and a clean shutdown). */
export async function drainBackgroundSends(): Promise<void> {
  while (background.size > 0) await Promise.all([...background]);
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

/** Forget what we remembered about a customer (after their points changed here). */
export function forgetBalance(businessId: string, phone: string): void {
  cache.delete(`${businessId}:${phone}`);
}

/**
 * A customer's points as Customer OS holds them. Never throws and never blocks a page for long: if Customer OS is slow or
 * down the page shows "unavailable" instead. Short cache so a page refresh does not call out every time.
 */
export async function lookupBalance(ctx: TenantContext, customerId: string, opts: { fetchImpl?: FetchLike; fresh?: boolean } = {}): Promise<BalanceView> {
  const loaded = await loadTarget(ctx.businessId);
  if (!loaded || !loaded.enabled) return { state: "off" };
  const customer = await db.customer.findFirst({ where: { id: customerId, businessId: ctx.businessId }, select: { phone: true } });
  if (!customer) return { state: "unavailable" };
  const ck = `${ctx.businessId}:${customer.phone}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_MS && !opts.fetchImpl && !opts.fresh) return { state: "ok", balance: hit.value };
  const res = await cosLookup(loaded.target, customer.phone, { fetchImpl: opts.fetchImpl });
  if (!res.ok) return { state: "unavailable" };
  cache.set(ck, { at: Date.now(), value: res.data });
  if (cache.size > 500) cache.clear();
  return { state: "ok", balance: res.data };
}
