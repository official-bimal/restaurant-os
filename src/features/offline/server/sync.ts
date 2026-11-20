import { db } from "@/server/db";
import { Prisma } from "@/generated/prisma/client";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { normalizePhone } from "@/server/phone";
import { localDate } from "@/lib/business-day";
import { pushToTeam } from "@/features/notifications/server/push";
import { deductForInvoice } from "@/features/stock/server/deduct";
import { applyCampaignBonus } from "@/features/campaigns/server/bonus";
import { applyCheckoutLoyalty, planEarn, settingsFromBusiness } from "@/features/loyalty/server/checkout";
import { enqueueIfLinked, flushSoon } from "@/features/customeros/server/outbox";
import { billTimeProblem, checkDiscount, checkPayments, OfflineBillError, priceOfflineBill, type OfflineBillInput } from "../billing";
import { verifySnapshot } from "./snapshot";

/**
 * A bill that was made on a phone with no connection arrives. The server does not take the phone's word for anything that
 * matters: prices come from the snapshot it signed itself, the total is worked out again with the same code, the invoice
 * number must be one reserved for that phone, and the bill is recorded dated when the sale really happened. A repeat send of the
 * same bill changes nothing. Anything that cannot be accepted comes back with a code and a plain reason, and nothing is half done.
 */

export type SyncCode = "OK" | "TOTAL_MISMATCH" | "NUMBER_NOT_RESERVED" | "NUMBER_TAKEN" | "DAY_CLOSED" | "INVALID";

export type SyncResult =
  | { ok: true; invoiceNumber: number; orderNumber: number; repeat: boolean }
  | { ok: false; code: SyncCode; error: string };

class Refuse extends Error {
  constructor(
    public code: SyncCode,
    message: string,
  ) {
    super(message);
  }
}

export async function syncOfflineBill(ctx: TenantContext, input: { snapshot: string; sig: string; bill: OfflineBillInput }, now: Date = new Date()): Promise<SyncResult> {
  if (!can(ctx, "bill.checkout") || !can(ctx, "order.create")) throw new DomainError("You do not have permission to bill.");
  const bill = input.bill;
  try {
    const snap = verifySnapshot(input.snapshot, input.sig, ctx, now);
    const branchId = snap.branchId;

    const timeProblem = billTimeProblem(snap, bill.billedAt, now);
    if (timeProblem) throw new Refuse("INVALID", timeProblem);
    const billedAt = new Date(bill.billedAt);

    try {
      checkDiscount(bill.discount);
      const priced = priceOfflineBill(snap, bill.items, bill.discount);
      checkPayments(priced.totals.grandTotal, bill.payments);
      if (priced.totals.grandTotal !== bill.expectedTotal) {
        throw new Refuse("TOTAL_MISMATCH", `This bill came to ${priced.totals.grandTotal / 100} here but ${bill.expectedTotal / 100} on the phone. It was not recorded: ask the owner to look at it.`);
      }
      try {
        return await record(ctx, snap.business.timezone, branchId, billedAt, bill, priced);
      } catch (e) {
        // Two sends of the same bill at the same moment: the second finds the first and answers with it.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return await record(ctx, snap.business.timezone, branchId, billedAt, bill, priced);
        throw e;
      }
    } catch (e) {
      if (e instanceof OfflineBillError) throw new Refuse("INVALID", e.message);
      throw e;
    }
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, code: e.code, error: e.message };
    if (e instanceof DomainError) return { ok: false, code: "INVALID", error: e.message };
    throw e;
  }
}

async function record(
  ctx: TenantContext,
  timezone: string,
  branchId: string,
  billedAt: Date,
  bill: OfflineBillInput,
  priced: ReturnType<typeof priceOfflineBill>,
): Promise<SyncResult> {
  const { businessId } = ctx;
  const { lines, totals } = priced;
  const day = localDate(billedAt, timezone);

  // Who the customer is, for loyalty points (the phone number only; spending points needs the server).
  let customerPhone: string | null = null;
  if (bill.customerPhone?.trim()) {
    try {
      customerPhone = normalizePhone(bill.customerPhone);
    } catch {
      throw new Refuse("INVALID", "The customer's phone number is not valid.");
    }
  }

  let lowStock: { name: string; status: string }[] = [];
  let queuedForCustomerOs = false;
  const result = await db.$transaction(async (tx): Promise<SyncResult> => {
    // A repeat send of the same bill: answer with what was recorded the first time.
    const again = await tx.invoice.findUnique({ where: { businessId_offlineKey: { businessId, offlineKey: bill.key } }, include: { order: { select: { number: true } } } });
    if (again) return { ok: true, invoiceNumber: again.number, orderNumber: again.order.number, repeat: true };

    // The number must be one set aside for this phone.
    const block = await tx.offlineNumberBlock.findFirst({ where: { businessId, deviceId: bill.deviceId, fromNumber: { lte: bill.invoiceNumber }, toNumber: { gte: bill.invoiceNumber } } });
    if (!block) throw new Refuse("NUMBER_NOT_RESERVED", `Invoice number ${bill.invoiceNumber} was not set aside for this phone. It was not recorded: ask the owner to look at it.`);
    if (await tx.invoice.findFirst({ where: { businessId, number: bill.invoiceNumber }, select: { id: true } })) {
      throw new Refuse("NUMBER_TAKEN", `Invoice number ${bill.invoiceNumber} is already used by another bill. It was not recorded: ask the owner to look at it.`);
    }

    // A day that has been closed does not change afterwards. The owner can reopen it and the bill can be sent again.
    if (await tx.dayClose.findUnique({ where: { branchId_date: { branchId, date: day } }, select: { id: true } })) {
      throw new Refuse("DAY_CLOSED", `The day this bill belongs to (${day}) has already been closed. Ask the owner to reopen it, then send the bill again.`);
    }

    let tableId: string | null = null;
    if (bill.type === "DINE_IN") {
      if (!bill.tableId) throw new Refuse("INVALID", "A dine-in bill needs a table.");
      const table = await tx.diningTable.findFirst({ where: { id: bill.tableId, businessId, branchId }, select: { id: true } });
      if (!table) throw new Refuse("INVALID", "That table no longer exists.");
      tableId = table.id;
    }

    let customerId: string | null = null;
    if (customerPhone) {
      const found = await tx.customer.findUnique({ where: { businessId_phone: { businessId, phone: customerPhone } }, select: { id: true } });
      customerId = found?.id ?? (await tx.customer.create({ data: { businessId, phone: customerPhone }, select: { id: true } })).id;
    }

    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    const { orderCounter } = await tx.business.update({ where: { id: businessId }, data: { orderCounter: { increment: 1 } }, select: { orderCounter: true } });
    const order = await tx.order.create({
      data: {
        businessId,
        branchId,
        number: orderCounter,
        type: bill.type,
        tableId,
        status: "PAID",
        customerId,
        idempotencyKey: `offline:${bill.key}`,
        createdById: ctx.userId,
        createdAt: billedAt,
        closedAt: billedAt,
      },
    });
    for (const l of lines) {
      await tx.orderItem.create({
        data: { businessId, orderId: order.id, menuItemId: l.menuItemId, name: l.name, unitPrice: l.unitPrice, quantity: l.quantity, note: l.note, status: "SERVED", createdAt: billedAt, statusAt: billedAt },
      });
    }

    const settings = settingsFromBusiness(business);
    const earned = planEarn(settings, { customerId }, totals.grandTotal - totals.deliveryFee);
    const invoice = await tx.invoice.create({
      data: {
        businessId,
        branchId,
        orderId: order.id,
        number: bill.invoiceNumber,
        subtotal: totals.subtotal,
        discount: totals.discount,
        serviceCharge: totals.serviceCharge,
        vat: totals.vat,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        loyaltyDiscount: 0,
        deliveryFee: 0,
        customerId,
        pointsEarned: earned,
        pointsRedeemed: 0,
        createdAt: billedAt,
        offlineKey: bill.key,
        offlineDeviceId: bill.deviceId,
        syncedAt: new Date(),
      },
    });
    await tx.payment.createMany({ data: bill.payments.map((p) => ({ businessId, invoiceId: invoice.id, method: p.method, amount: p.amount, createdAt: billedAt })) });
    await applyCheckoutLoyalty(tx, { businessId, userId: ctx.userId, customerId, invoiceId: invoice.id, grandTotal: totals.grandTotal, redeemed: 0, earned });
    queuedForCustomerOs = await enqueueIfLinked(tx, { businessId, invoiceId: invoice.id, customerId });
    await applyCampaignBonus(tx, { businessId, customerId, invoiceId: invoice.id, userId: ctx.userId });
    lowStock = await deductForInvoice(tx, { businessId, branchId, invoiceId: invoice.id, userId: ctx.userId, items: lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, addOnIds: [] })) });
    // A late bill takes the place of a gap that was recorded for its number.
    await tx.invoiceGap.deleteMany({ where: { businessId, number: bill.invoiceNumber } });
    await audit(tx, { ...ctx, branchId }, "bill.offline", "Invoice", invoice.id, { number: invoice.number, total: totals.grandTotal, device: bill.deviceId.slice(0, 8), billedAt: billedAt.toISOString() });
    return { ok: true, invoiceNumber: invoice.number, orderNumber: order.number, repeat: false };
  });

  if (result.ok && !result.repeat && queuedForCustomerOs) flushSoon(businessId);
  if (result.ok && !result.repeat && lowStock.length > 0) {
    const names = lowStock.map((i) => i.name);
    void pushToTeam({ businessId, branchId, permission: "stock.view", payload: { title: lowStock.some((i) => i.status !== "LOW") ? "Stock has run out" : "Stock is running low", body: names.slice(0, 3).join(", "), url: "/stock", tag: "low-stock" } });
  }
  return result;
}
