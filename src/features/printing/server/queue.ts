import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { printerColumns, buildEscPos } from "@/lib/escpos";
import { documentLines, type DocKind } from "./render";
import { getPrintConfig, paperFor } from "./settings";

/**
 * The print queue. Staff (or the "print kitchen slips automatically" setting) put jobs in; a small program next to the
 * printer collects them with the business's printer key, prints them, and reports back. A kitchen slip lists only the items
 * not printed before, and an item is marked printed only when the printer confirms, so a failed print never loses an order
 * and a reprint never repeats old items. Nothing here talks to a printer itself.
 */

const MAX_ATTEMPTS = 5;
/** A job collected but never confirmed is offered again after this long. */
const RECLAIM_MS = 2 * 60 * 1000;

function needPrint(ctx: TenantContext) {
  if (!can(ctx, "order.edit") && !can(ctx, "bills.view") && !can(ctx, "kitchen.update") && !can(ctx, "bill.checkout")) {
    throw new DomainError("You do not have permission to print.");
  }
}

// --- putting jobs in -------------------------------------------------------------------

/** Queue a kitchen slip for an order, unless one is already waiting (it will include everything not yet printed). */
export async function queueKitchenSlip(businessId: string, branchId: string, orderId: string, createdById: string | null) {
  // Two items added at nearly the same moment must not each queue a slip: lock on the order while checking and creating.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-kitchen:${orderId}`}))`;
    const waiting = await tx.printJob.findFirst({ where: { businessId, branchId, orderId, kind: "KITCHEN", status: "QUEUED" }, select: { id: true } });
    if (waiting) return waiting.id;
    const job = await tx.printJob.create({ data: { businessId, branchId, kind: "KITCHEN", orderId, createdById }, select: { id: true } });
    return job.id;
  });
}

/** Called after items are added to an order: queue a slip if this business prints kitchen slips automatically. Never throws. */
export async function autoQueueKitchenSlip(businessId: string, branchId: string, orderId: string, userId: string | null) {
  try {
    const cfg = await getPrintConfig(businessId);
    if (cfg.autoKitchenPrint) await queueKitchenSlip(businessId, branchId, orderId, userId);
  } catch {
    // a printing problem must never stop an order being taken
  }
}

/** Staff press "Send to printer": queue a document. */
export async function queueDocument(ctx: TenantContext, kind: DocKind, id: string) {
  needPrint(ctx);
  const { businessId, branchId } = scope(ctx);
  if (kind === "kitchen") {
    const order = await db.order.findFirst({ where: { id, businessId, branchId }, select: { id: true } });
    if (!order) throw new DomainError("Order not found.");
    return queueKitchenSlip(businessId, branchId, id, ctx.userId);
  }
  if (kind === "invoice") {
    const inv = await db.invoice.findFirst({ where: { id, businessId, branchId }, select: { id: true } });
    if (!inv) throw new DomainError("Invoice not found.");
    const job = await db.printJob.create({ data: { businessId, branchId, kind: "RECEIPT", invoiceId: id, createdById: ctx.userId }, select: { id: true } });
    return job.id;
  }
  const note = await db.creditNote.findFirst({ where: { id, businessId, invoice: { branchId } }, select: { id: true } });
  if (!note) throw new DomainError("Credit note not found.");
  const job = await db.printJob.create({ data: { businessId, branchId, kind: "CREDIT_NOTE", creditNoteId: id, createdById: ctx.userId }, select: { id: true } });
  return job.id;
}

// --- looking at the queue ----------------------------------------------------------------

export async function listJobs(ctx: TenantContext) {
  if (!can(ctx, "print.manage")) throw new DomainError("You do not have permission to see the print queue.");
  const { businessId, branchId } = scope(ctx);
  return db.printJob.findMany({ where: { businessId, branchId }, orderBy: { createdAt: "desc" }, take: 30 });
}

export async function cancelJob(ctx: TenantContext, jobId: string) {
  if (!can(ctx, "print.manage")) throw new DomainError("You do not have permission to change the print queue.");
  const { businessId, branchId } = scope(ctx);
  const r = await db.printJob.updateMany({ where: { id: jobId, businessId, branchId, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "CANCELLED" } });
  if (r.count === 0) throw new DomainError("That job cannot be cancelled any more.");
  await db.$transaction((tx) => audit(tx, ctx, "print.cancel", "PrintJob", jobId));
}

export async function retryJob(ctx: TenantContext, jobId: string) {
  if (!can(ctx, "print.manage")) throw new DomainError("You do not have permission to change the print queue.");
  const { businessId, branchId } = scope(ctx);
  const r = await db.printJob.updateMany({ where: { id: jobId, businessId, branchId, status: "FAILED" }, data: { status: "QUEUED", attempts: 0, error: null, claimedAt: null } });
  if (r.count === 0) throw new DomainError("Only a failed job can be tried again.");
}

// --- the printer program's side -----------------------------------------------------------

export interface AgentJob {
  id: string;
  kind: string;
  branchId: string;
  paperWidthMm: number;
  columns: number;
  /** The printer bytes (ESC/POS), base64. */
  escposBase64: string;
  /** The same content as plain lines, for a printer program that does its own formatting. */
  text: string[];
}

/** The system's own identity when it renders a job: limited to one business and branch, never a signed-in person. */
function systemCtx(businessId: string, branchId: string): TenantContext {
  return { userId: "print-queue", businessId, branchId, branchIds: [branchId], role: "OWNER" };
}

/**
 * Hand out up to `limit` waiting jobs (oldest first) and mark them collected. A kitchen slip that turns out to have nothing
 * new on it is closed instead of printed.
 */
export async function collectJobs(businessId: string, opts: { branchId?: string; limit?: number } = {}): Promise<AgentJob[]> {
  const cfg = await getPrintConfig(businessId);
  const reclaim = new Date(Date.now() - RECLAIM_MS);
  const candidates = await db.printJob.findMany({
    where: {
      businessId,
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
      status: "QUEUED",
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ claimedAt: null }, { claimedAt: { lt: reclaim } }],
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(20, Math.max(1, opts.limit ?? 10)),
  });
  const out: AgentJob[] = [];
  for (const job of candidates) {
    // Claim it so two collectors do not both print it.
    const claimed = await db.printJob.updateMany({
      where: { id: job.id, businessId, status: "QUEUED", OR: [{ claimedAt: null }, { claimedAt: { lt: reclaim } }] },
      data: { claimedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;
    try {
      const ctx = systemCtx(businessId, job.branchId);
      const kind: DocKind = job.kind === "KITCHEN" ? "kitchen" : job.kind === "RECEIPT" ? "invoice" : "credit-note";
      const id = job.orderId ?? job.invoiceId ?? job.creditNoteId;
      if (!id) throw new DomainError("The job has nothing to print.");
      const page = paperFor(cfg);
      const cols = printerColumns(page.widthMm);
      const { lines, itemIds } = await documentLines(ctx, kind, id, cols, cfg, { onlyUnprinted: kind === "kitchen" });
      if (kind === "kitchen" && itemIds.length === 0) {
        await db.printJob.update({ where: { id: job.id }, data: { status: "CANCELLED", error: "Nothing new to print." } });
        continue;
      }
      await db.printJob.update({ where: { id: job.id }, data: { itemIds } });
      out.push({
        id: job.id,
        kind: job.kind,
        branchId: job.branchId,
        paperWidthMm: page.widthMm,
        columns: cols,
        escposBase64: Buffer.from(buildEscPos(lines)).toString("base64"),
        text: lines.map((l) => l.text),
      });
    } catch (e) {
      await db.printJob.update({ where: { id: job.id }, data: { status: job.attempts + 1 >= MAX_ATTEMPTS ? "FAILED" : "QUEUED", error: (e instanceof Error ? e.message : "failed").slice(0, 200), claimedAt: null } });
    }
  }
  return out;
}

/** The printer program says how a job went. A success marks a kitchen slip's items printed. */
export async function finishJob(businessId: string, jobId: string, ok: boolean, error?: string) {
  const job = await db.printJob.findFirst({ where: { id: jobId, businessId } });
  if (!job) throw new DomainError("Job not found.");
  if (job.status === "PRINTED" || job.status === "CANCELLED") return;
  if (ok) {
    await db.$transaction(async (tx) => {
      await tx.printJob.update({ where: { id: jobId }, data: { status: "PRINTED", printedAt: new Date(), error: null } });
      if (job.itemIds.length > 0) {
        await tx.orderItem.updateMany({ where: { businessId, id: { in: job.itemIds }, printedAt: null }, data: { printedAt: new Date() } });
      }
    });
    return;
  }
  await db.printJob.update({
    where: { id: jobId },
    data: { status: job.attempts >= MAX_ATTEMPTS ? "FAILED" : "QUEUED", error: (error ?? "The printer reported a problem.").slice(0, 200), claimedAt: null },
  });
}
