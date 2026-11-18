import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { scope } from "@/server/branch";
import { closeTableSittingsInTx } from "@/features/guest/server/service";
import { assertDayOpen } from "@/features/reports/server/day-lock";
import { enqueueRefundIfLinked, enqueueReturnReward, flushSoon } from "@/features/customeros/server/outbox";

/**
 * Cancel an unpaid order, or refund a paid invoice.
 *
 * Neither deletes anything. A cancelled order keeps its items marked cancelled and a reason; a
 * refund is a numbered credit note beside the untouched invoice. Both need a reason and are audited.
 */

const OPEN = ["OPEN", "SERVED"] as const;

function cleanReason(reason: string): string {
  const r = reason.trim().replace(/\s+/g, " ");
  if (r.length < 3) throw new DomainError("Give a reason (at least a few words).");
  if (r.length > 200) throw new DomainError("The reason is too long (200 characters at most).");
  return r;
}

// --- cancel an open order ----------------------------------------------------

export async function cancelOrder(ctx: TenantContext, orderId: string, rawReason: string) {
  const reason = cleanReason(rawReason);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, businessId, branchId }, include: { items: true } });
    if (!order) throw new DomainError("Order not found.");
    if (order.status === "PAID") throw new DomainError("This bill is already paid. Refund the invoice instead.");
    if (order.status === "CANCELLED") throw new DomainError("This order was already cancelled.");
    if (order.status === "MERGED") throw new DomainError("This bill was merged into another one. Cancel that one instead.");

    // Cancelling something with food on it needs authority; an empty order a waiter opened by mistake does not.
    const active = order.items.filter((i) => i.status !== "CANCELLED");
    const needed = active.length > 0 ? "order.void" : "order.edit";
    if (!can(ctx.role, needed)) throw new DomainError("You do not have permission to cancel this order.");

    const now = new Date();
    await tx.orderItem.updateMany({
      where: { businessId, orderId, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED", cancelReason: `Order cancelled: ${reason}`, statusAt: now },
    });
    await tx.order.update({
      where: { businessId_id: { businessId, id: orderId } },
      data: { status: "CANCELLED", cancelReason: reason, closedAt: now },
    });

    if (order.tableId) {
      const remaining = await tx.order.count({
        where: { businessId, tableId: order.tableId, status: { in: [...OPEN] }, id: { not: orderId } },
      });
      if (remaining === 0) {
        await tx.diningTable.update({ where: { businessId_id: { businessId, id: order.tableId } }, data: { state: "FREE" } });
        await closeTableSittingsInTx(tx, businessId, order.tableId, { reason: "CANCELLED" });
      }
    }
    await audit(tx, ctx, "order.cancel", "Order", orderId, {
      number: order.number,
      reason,
      items: active.map((i) => ({ name: i.name, qty: i.quantity, status: i.status })),
    });
  });
}

// --- refund a paid invoice -----------------------------------------------------

type Method = "CASH" | "QR" | "CARD" | "CREDIT";
type Part = "subtotal" | "discount" | "loyaltyDiscount" | "serviceCharge" | "vat" | "roundOff";

/**
 * Refund an invoice, in full or in part, with a numbered credit note. An invoice can have several credit notes; together
 * they can never come to more than it was paid. Leave `amount` out to refund everything that is left.
 *
 * Each note takes its share of every part of the bill (subtotal, discount, service charge, VAT, round-off) in proportion
 * to the amount refunded, and the note that finishes the refund takes exactly what is left, so the notes always add up to
 * the invoice. The money goes back by the methods it came in by (in proportion), or by one method if you choose it and it
 * was paid by enough of that method. The customer's points are put back in the same proportion. Food already made is not
 * put back in stock. Checked and written under a lock on the invoice, so two refunds at once cannot overshoot.
 */
export async function refundInvoice(ctx: TenantContext, invoiceId: string, rawReason: string, opts: { amount?: number; method?: string; returnReward?: boolean } = {}) {
  if (!can(ctx.role, "bill.refund")) throw new DomainError("You do not have permission to refund bills.");
  const reason = cleanReason(rawReason);
  const { businessId, branchId } = scope(ctx);
  if (opts.method !== undefined && !["CASH", "QR", "CARD", "CREDIT"].includes(opts.method)) throw new DomainError("Choose how the money is handed back.");

  let queuedForCustomerOs = false;
  const creditNote = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} AND "businessId" = ${businessId} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, businessId, branchId },
      include: { payments: true, creditNotes: { include: { refunds: true } } },
    });
    if (!invoice) throw new DomainError("Invoice not found.");
    await assertDayOpen(tx, businessId, branchId);

    const refunded = invoice.creditNotes.reduce((n, c) => n + c.grandTotal, 0);
    const remaining = invoice.grandTotal - refunded;
    if (remaining <= 0) throw new DomainError("This invoice has already been refunded in full.");
    const amount = opts.amount ?? remaining;
    if (!Number.isInteger(amount) || amount < 1) throw new DomainError("Enter an amount of Rs 0.01 or more.");
    if (amount > remaining) throw new DomainError(`Only ${money(remaining)} is left to refund on this invoice.`);
    const finishes = amount === remaining;

    // How much of each payment method can still go back.
    const room: Record<Method, number> = { CASH: 0, QR: 0, CARD: 0, CREDIT: 0 };
    for (const p of invoice.payments) room[p.method as Method] += p.amount;
    for (const c of invoice.creditNotes) for (const r of c.refunds) room[r.method as Method] -= r.amount;
    const methods = (Object.keys(room) as Method[]).filter((m) => room[m] > 0);
    const back: Partial<Record<Method, number>> = {};
    if (opts.method) {
      const m = opts.method as Method;
      if (room[m] < amount) throw new DomainError(`Only ${money(Math.max(0, room[m]))} of this bill was paid by ${m.toLowerCase()} and is still refundable. Choose another method or split it.`);
      back[m] = amount;
    } else {
      let given = 0;
      for (const m of methods) {
        back[m] = finishes ? room[m] : Math.floor((amount * room[m]) / remaining);
        given += back[m]!;
      }
      // Whole-paisa leftovers go to the methods that still have room.
      for (const m of methods) {
        const extra = Math.min(amount - given, room[m] - back[m]!);
        if (extra > 0) {
          back[m]! += extra;
          given += extra;
        }
      }
      if (given !== amount) throw new DomainError("Could not split that refund across the payment methods. Try a single method.");
    }

    const share = (k: Part) => {
      if (finishes) return invoice[k] - invoice.creditNotes.reduce((n, c) => n + c[k], 0);
      return Math.round((invoice[k] * amount) / invoice.grandTotal);
    };
    const { creditNoteCounter } = await tx.business.update({
      where: { id: businessId },
      data: { creditNoteCounter: { increment: 1 } },
      select: { creditNoteCounter: true },
    });
    const note = await tx.creditNote.create({
      data: {
        businessId,
        invoiceId: invoice.id,
        number: creditNoteCounter,
        subtotal: share("subtotal"),
        discount: share("discount"),
        loyaltyDiscount: share("loyaltyDiscount"),
        serviceCharge: share("serviceCharge"),
        vat: share("vat"),
        roundOff: share("roundOff"),
        grandTotal: amount,
        partial: !finishes,
        reason,
        createdById: ctx.userId,
      },
    });
    await tx.refundPayment.createMany({
      data: (Object.entries(back) as [Method, number][]).filter(([, a]) => a > 0).map(([method, a]) => ({ businessId, creditNoteId: note.id, method, amount: a })),
    });

    // If Customer OS gave the points for this bill, it takes them back too (sent after this refund is saved).
    queuedForCustomerOs = await enqueueRefundIfLinked(tx, { businessId, invoiceId: invoice.id, creditNoteId: note.id });
    // The owner may also give back the reward that was used on this bill, but only when the whole bill ends up refunded.
    if (opts.returnReward) {
      if (!finishes) throw new DomainError("A reward can only be given back when the whole bill is refunded. Do it with the refund that finishes it.");
      const used = await tx.customerOsEvent.findFirst({ where: { businessId, kind: "REDEEM", invoiceId: invoice.orderId }, select: { refId: true } });
      if (!used) throw new DomainError("No Customer OS reward was used on this bill.");
      if (!(await enqueueReturnReward(tx, { businessId, invoiceId: invoice.id, externalId: used.refId }))) throw new DomainError("The reward on this bill was already given back.");
      queuedForCustomerOs = true;
    }
    const customerOsHoldsPoints = !!(await tx.customerOsLink.findUnique({ where: { businessId }, select: { businessId: true } }));

    if (invoice.customerId) {
      const customer = await tx.customer.findFirst({ where: { id: invoice.customerId, businessId } });
      if (customer) {
        // Earned points are taken back (the balance may go below zero if they were already spent; that blocks spending
        // until they earn it back). Spent points are returned. Each note does its share; the last one does the rest.
        const entries = await tx.loyaltyEntry.findMany({ where: { businessId, invoiceId: invoice.id, kind: "REVERSAL" }, select: { points: true } });
        const takenBack = -entries.filter((e) => e.points < 0).reduce((n, e) => n + e.points, 0);
        const returned = entries.filter((e) => e.points > 0).reduce((n, e) => n + e.points, 0);
        const earnedNow = customerOsHoldsPoints ? 0 : finishes ? invoice.pointsEarned - takenBack : Math.round((invoice.pointsEarned * amount) / invoice.grandTotal);
        // While Customer OS holds the points, this app's own balance is not touched (a reward used from Customer OS is not given back by a refund yet).
        const returnNow = customerOsHoldsPoints ? 0 : finishes ? invoice.pointsRedeemed - returned : Math.round((invoice.pointsRedeemed * amount) / invoice.grandTotal);
        const note2 = `Refund, credit note #${note.number}`;
        await tx.customer.update({
          where: { businessId_id: { businessId, id: customer.id } },
          data: {
            pointsBalance: { increment: returnNow - earnedNow },
            visitCount: finishes ? Math.max(0, customer.visitCount - 1) : customer.visitCount,
            totalSpend: Math.max(0, customer.totalSpend - amount),
          },
        });
        if (earnedNow > 0) {
          await tx.loyaltyEntry.create({ data: { businessId, customerId: customer.id, kind: "REVERSAL", points: -earnedNow, invoiceId: invoice.id, note: note2, createdById: ctx.userId } });
        }
        if (returnNow > 0) {
          await tx.loyaltyEntry.create({ data: { businessId, customerId: customer.id, kind: "REVERSAL", points: returnNow, invoiceId: invoice.id, note: note2, createdById: ctx.userId } });
        }
      }
    }
    await audit(tx, ctx, "bill.refund", "CreditNote", note.id, {
      invoice: invoice.number,
      creditNote: note.number,
      total: amount,
      partial: !finishes,
      methods: back,
      reason,
    });
    return note;
  });
  // After the refund is saved: tell Customer OS in the background (a failure never touches the refund).
  if (queuedForCustomerOs) flushSoon(businessId);
  return creditNote;
}

const money = (n: number) => `Rs ${(n / 100).toLocaleString("en-US", { minimumFractionDigits: n % 100 ? 2 : 0 })}`;
