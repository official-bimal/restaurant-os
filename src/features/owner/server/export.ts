import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { addDays, dayRange, isValidDate, localDate } from "@/lib/business-day";
import { buildXlsx, rupees, type Sheet } from "@/lib/xlsx";
import { getBranchRollup } from "@/features/reports/server/service";

/**
 * The accountant's workbook: one Excel file for a period, with the daily totals, every bill, payments by method, refunds,
 * cancelled bills and supplier bills. Amounts are in rupees. Owners only (it holds the whole business's sales). Every
 * query is filtered by businessId and limited to the branches the owner works in.
 */

export const MAX_EXPORT_DAYS = 366;

function need(ctx: TenantContext) {
  if (!can(ctx.role, "owner.control")) throw new DomainError("Only the owner can export the books.");
}

export async function buildAccountantWorkbook(ctx: TenantContext, from: string, to: string) {
  need(ctx);
  if (!isValidDate(from) || !isValidDate(to)) throw new DomainError("Choose a valid start and end date.");
  if (from > to) throw new DomainError("The start date must not be after the end date.");
  if (to > addDays(from, MAX_EXPORT_DAYS)) throw new DomainError("Choose a period of a year or less.");
  const { timezone, name } = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true, name: true } });
  const range = { gte: dayRange(from, timezone).start, lt: dayRange(to, timezone).end };
  const branchFilter = { in: ctx.branchIds };
  const when = (d: Date) => d.toLocaleString("en-GB", { timeZone: timezone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const day = (d: Date) => localDate(d, timezone);

  const [branches, invoices, notes, voidItems, bills] = await Promise.all([
    db.branch.findMany({ where: { businessId: ctx.businessId, id: branchFilter }, select: { id: true, name: true } }),
    db.invoice.findMany({
      where: { businessId: ctx.businessId, branchId: branchFilter, createdAt: range },
      include: { payments: true, customer: { select: { name: true } }, order: { select: { number: true, type: true, table: { select: { label: true } } } } },
      orderBy: { number: "asc" },
    }),
    db.creditNote.findMany({
      where: { businessId: ctx.businessId, invoice: { branchId: branchFilter }, createdAt: range },
      include: { refunds: true, invoice: { select: { number: true, branchId: true } } },
      orderBy: { number: "asc" },
    }),
    db.orderItem.findMany({
      where: { businessId: ctx.businessId, complimentary: false, cancelReason: { startsWith: "Order cancelled" }, order: { branchId: branchFilter, status: "CANCELLED", closedAt: range } },
      select: { unitPrice: true, quantity: true, order: { select: { id: true, number: true, closedAt: true, cancelReason: true, branchId: true } } },
    }),
    db.supplierBill.findMany({
      where: { businessId: ctx.businessId, voidedAt: null, billDate: { gte: from, lte: to } },
      include: { supplier: { select: { name: true } }, payments: { select: { amount: true } } },
      orderBy: { billDate: "asc" },
    }),
  ]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  // Daily totals, from the same reports the app shows, one row per day and branch.
  const summaryRows: Sheet["rows"] = [["Date", "Branch", "Bills", "Sales before refunds", "Discounts", "Service charge", "VAT", "Delivery fees", "Refunds", "Net after refunds", "Cash", "QR", "Card", "Credit"]];
  const totals = { bills: 0, gross: 0, discount: 0, service: 0, vat: 0, delivery: 0, refunds: 0, net: 0 };
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const roll = await getBranchRollup(ctx, { from: d, to: d });
    for (const b of roll.branches) {
      const r = b.report;
      if (r.sales.count === 0 && r.refunds.count === 0) continue;
      summaryRows.push([d, b.name, r.sales.count, rupees(r.sales.gross), rupees(r.sales.discount), rupees(r.sales.serviceCharge), rupees(r.sales.vat), rupees(r.sales.deliveryFee), rupees(r.refunds.total), rupees(r.net), rupees(r.byMethod.CASH.net), rupees(r.byMethod.QR.net), rupees(r.byMethod.CARD.net), rupees(r.byMethod.CREDIT.net)]);
      totals.bills += r.sales.count;
      totals.gross += r.sales.gross;
      totals.discount += r.sales.discount;
      totals.service += r.sales.serviceCharge;
      totals.vat += r.sales.vat;
      totals.delivery += r.sales.deliveryFee;
      totals.refunds += r.refunds.total;
      totals.net += r.net;
    }
  }
  summaryRows.push(["TOTAL", "", totals.bills, rupees(totals.gross), rupees(totals.discount), rupees(totals.service), rupees(totals.vat), rupees(totals.delivery), rupees(totals.refunds), rupees(totals.net), "", "", "", ""]);

  const sales: Sheet["rows"] = [["Invoice", "Date and time", "Branch", "Order", "Type / table", "Customer", "Subtotal", "Discount", "Reward discount", "Service charge", "VAT", "Delivery fee", "Round off", "Total", "Paid by"]];
  const payments: Sheet["rows"] = [["Invoice", "Date", "Method", "Amount"]];
  for (const i of invoices) {
    sales.push([i.number, when(i.createdAt), branchName.get(i.branchId) ?? "", i.order.number, i.order.table?.label ?? i.order.type.toLowerCase().replace("_", " "), i.customer?.name ?? "", rupees(i.subtotal), rupees(i.discount), rupees(i.loyaltyDiscount), rupees(i.serviceCharge), rupees(i.vat), rupees(i.deliveryFee), rupees(i.roundOff), rupees(i.grandTotal), [...new Set(i.payments.map((p) => p.method.toLowerCase()))].join(", ")]);
    for (const p of i.payments) payments.push([i.number, day(i.createdAt), p.method, rupees(p.amount)]);
  }

  const refunds: Sheet["rows"] = [["Credit note", "Date and time", "Invoice", "Branch", "Part refund", "Subtotal", "Discount", "Service charge", "VAT", "Round off", "Refunded", "Handed back by", "Reason"]];
  for (const n of notes) {
    refunds.push([n.number, when(n.createdAt), n.invoice.number, branchName.get(n.invoice.branchId) ?? "", n.partial ? "yes" : "no", rupees(n.subtotal), rupees(n.discount), rupees(n.serviceCharge), rupees(n.vat), rupees(n.roundOff), rupees(n.grandTotal), n.refunds.map((r) => `${r.method.toLowerCase()} ${(r.amount / 100).toFixed(2)}`).join("; "), n.reason]);
  }

  const voidByOrder = new Map<string, { number: number; at: Date | null; reason: string; branch: string; amount: number }>();
  for (const v of voidItems) {
    const cur = voidByOrder.get(v.order.id) ?? { number: v.order.number, at: v.order.closedAt, reason: v.order.cancelReason ?? "", branch: branchName.get(v.order.branchId) ?? "", amount: 0 };
    cur.amount += v.unitPrice * v.quantity;
    voidByOrder.set(v.order.id, cur);
  }
  const cancelled: Sheet["rows"] = [["Order", "Date and time", "Branch", "Value of items", "Reason"]];
  for (const v of [...voidByOrder.values()].sort((a, b) => a.number - b.number)) cancelled.push([v.number, v.at ? when(v.at) : "", v.branch, rupees(v.amount), v.reason]);

  const supplier: Sheet["rows"] = [["Bill date", "Supplier", "Their invoice no.", "Due date", "Amount", "Paid", "Still owed", "Note"]];
  for (const b of bills) {
    const paid = b.payments.reduce((n, p) => n + p.amount, 0);
    supplier.push([b.billDate, b.supplier.name, b.number ?? "", b.dueDate ?? "", rupees(b.amount), rupees(paid), rupees(b.amount - paid), b.note ?? ""]);
  }

  // Invoice numbers set aside for offline phones that no invoice uses: the series is always accounted for.
  const gapRows = await db.invoiceGap.findMany({ where: { businessId: ctx.businessId }, orderBy: { number: "asc" } });
  const gaps: Sheet["rows"] = [["Invoice number", "Reason", "Recorded"]];
  for (const g of gapRows) gaps.push([g.number, g.reason, when(g.createdAt)]);

  const readme: Sheet["rows"] = [
    ["About this file"],
    [`${name}: books from ${from} to ${to}`],
    ["Amounts are in rupees. Dates and times are in the business's own time zone."],
    ["Daily totals come from the same reports as the app (after refunds). Sales, Payments, Refunds, Cancelled bills and Supplier bills list every record in the period."],
    ["Bills made on phones with no connection are dated when the sale happened. \"Number gaps\" lists invoice numbers that were set aside for such phones and never used, so every number is accounted for."],
    ["This is a record of what the app holds. It is not a tax return, and it does not work out income tax or other statutory deductions."],
  ];

  await db.$transaction((tx) => audit(tx, ctx, "owner.export", "Business", ctx.businessId, { from, to, invoices: invoices.length }));
  return buildXlsx([
    { name: "About", rows: readme, widths: [110] },
    { name: "Daily totals", rows: summaryRows, widths: [12, 16, 8, 18, 12, 14, 12, 14, 12, 18, 12, 12, 12, 12] },
    { name: "Sales", rows: sales, widths: [9, 20, 14, 8, 14, 18, 12, 11, 14, 14, 11, 12, 10, 12, 16] },
    { name: "Payments", rows: payments, widths: [9, 12, 10, 12] },
    { name: "Refunds", rows: refunds, widths: [11, 20, 9, 14, 11, 12, 11, 14, 11, 10, 12, 24, 30] },
    { name: "Cancelled bills", rows: cancelled, widths: [8, 20, 14, 14, 36] },
    { name: "Supplier bills", rows: supplier, widths: [12, 22, 16, 12, 12, 12, 12, 30] },
    { name: "Number gaps", rows: gaps, widths: [14, 50, 20] },
  ]);
}
