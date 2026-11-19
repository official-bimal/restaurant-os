import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { groupByStation, receiptLines } from "../receipt";
import { billDates, copyNote, invoiceLabel } from "@/features/billing/ird";

/**
 * The data behind printed pages. Each document is limited to the business and the branch the person is working in, and
 * to people who may see that kind of record. Printing a receipt or credit note is written to the audit log (a reprint is
 * worth being able to see); a kitchen ticket is not, because it changes nothing.
 */

function needBills(ctx: TenantContext) {
  if (!can(ctx.role, "bills.view") && !can(ctx.role, "bill.checkout")) throw new DomainError("You do not have permission to print bills.");
}

async function header(businessId: string, branchId: string) {
  const [business, branch] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, panNumber: true, timezone: true } }),
    db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId, id: branchId } }, select: { name: true, address: true } }),
  ]);
  return { business: business.name, pan: business.panNumber, timezone: business.timezone, branch: branch.name, address: branch.address };
}

export async function getReceipt(ctx: TenantContext, invoiceId: string) {
  needBills(ctx);
  const { businessId, branchId } = scope(ctx);
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, businessId, branchId },
    include: {
      payments: { orderBy: { createdAt: "asc" } },
      creditNotes: { orderBy: { number: "asc" } },
      customer: { select: { name: true } },
      order: { include: { table: { select: { label: true } }, items: { orderBy: { createdAt: "asc" }, include: { addOns: true } } } },
    },
  });
  if (!invoice) throw new DomainError("Invoice not found.");
  const head = await header(businessId, branchId);
  // The first print is the original; each later one is marked as a copy. The count and the audit entry are written together.
  const printsBefore = await db.$transaction(async (tx) => {
    const after = await tx.invoice.update({ where: { businessId_id: { businessId, id: invoice.id } }, data: { printCount: { increment: 1 } }, select: { printCount: true } });
    await audit(tx, ctx, "print.receipt", "Invoice", invoice.id, { number: invoice.number, print: after.printCount });
    return after.printCount - 1;
  });
  const dates = billDates(invoice.createdAt, head.timezone);
  const order = invoice.order;
  return {
    ...head,
    invoice,
    label: invoiceLabel(dates.fiscalYear, invoice.number),
    bsDate: dates.bs,
    copy: copyNote(printsBefore),
    orderNumber: order.number,
    where: order.type === "DINE_IN" ? (order.table?.label ?? "Dine in") : order.type === "DELIVERY" ? "Delivery" : order.type === "TAKEAWAY" ? "Takeaway" : "Quick bill",
    customer: invoice.customer?.name ?? null,
    lines: receiptLines(order.items),
    refunded: invoice.creditNotes.reduce((n, c) => n + c.grandTotal, 0),
  };
}

export async function getCreditNote(ctx: TenantContext, creditNoteId: string) {
  needBills(ctx);
  const { businessId, branchId } = scope(ctx);
  const note = await db.creditNote.findFirst({
    where: { id: creditNoteId, businessId, invoice: { branchId } },
    include: { refunds: true, invoice: { select: { number: true, grandTotal: true, createdAt: true, buyerName: true, buyerPan: true } } },
  });
  if (!note) throw new DomainError("Credit note not found.");
  const head = await header(businessId, branchId);
  await db.$transaction((tx) => audit(tx, ctx, "print.creditNote", "CreditNote", note.id, { number: note.number }));
  const noteDates = billDates(note.createdAt, head.timezone);
  const invDates = billDates(note.invoice.createdAt, head.timezone);
  return {
    ...head,
    note,
    label: invoiceLabel(noteDates.fiscalYear, note.number),
    bsDate: noteDates.bs,
    invoiceLabel: invoiceLabel(invDates.fiscalYear, note.invoice.number),
    buyerName: note.invoice.buyerName,
    buyerPan: note.invoice.buyerPan,
  };
}

/** What the kitchen needs to cook for an order: its live items by station, with notes and add-ons. */
export async function getKitchenSlip(ctx: TenantContext, orderId: string, opts: { onlyUnprinted?: boolean } = {}) {
  if (!can(ctx.role, "order.edit") && !can(ctx.role, "kitchen.update")) throw new DomainError("You do not have permission to print kitchen tickets.");
  const { businessId, branchId } = scope(ctx);
  const order = await db.order.findFirst({
    where: { id: orderId, businessId, branchId },
    include: {
      table: { select: { label: true } },
      items: { orderBy: { createdAt: "asc" }, include: { addOns: true, menuItem: { select: { stationId: true, station: { select: { name: true } } } } } },
    },
  });
  if (!order) throw new DomainError("Order not found.");
  // A branch can send a dish to a different station than the shared menu does.
  const overrides = await db.branchMenuItem.findMany({
    where: { businessId, branchId, stationId: { not: null }, menuItemId: { in: [...new Set(order.items.map((i) => i.menuItemId))] } },
    include: { station: { select: { name: true } } },
  });
  const stationOf = new Map(overrides.map((o) => [o.menuItemId, o.station?.name ?? null]));
  const [head] = await Promise.all([header(businessId, branchId)]);
  const live = order.items
    .filter((i) => !opts.onlyUnprinted || i.printedAt === null)
    .map((i) => ({
    id: i.id,
    name: i.name,
    quantity: i.quantity,
    note: i.note,
    status: i.status,
    addOns: i.addOns.map((a) => a.name),
    station: stationOf.get(i.menuItemId) ?? i.menuItem.station?.name ?? null,
  }));
  return {
    ...head,
    number: order.number,
    type: order.type,
    table: order.table?.label ?? null,
    note: order.note,
    createdAt: order.createdAt,
    groups: groupByStation(live),
  };
}
