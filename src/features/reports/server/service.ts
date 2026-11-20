import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { scope } from "@/server/branch";
import { audit, type Tx } from "@/server/audit";
import type { Prisma } from "@/generated/prisma/client";
import { addDays, dayRange, isValidDate, localDate } from "@/lib/business-day";
import { buildReport, combineReports, type DayReport, type Method } from "@/features/reports/report";

/**
 * Daily report, day close and reopen. Every query is filtered by businessId, and the "day" is
 * the business's own calendar date in its own time zone.
 */

function needView(ctx: TenantContext) {
  if (!can(ctx, "report.view")) throw new DomainError("You do not have permission to see reports.");
}

function checkDate(date: string) {
  if (!isValidDate(date)) throw new DomainError("Choose a valid date.");
}

/** One branch's report for a day, or for a run of days when `dateTo` is given (both ends included). */
async function loadReport(tx: Tx, businessId: string, branchId: string, timeZone: string, date: string, dateTo: string = date): Promise<DayReport> {
  const start = dayRange(date, timeZone).start;
  const end = dayRange(dateTo, timeZone).end;
  const inRange = { gte: start, lt: end };

  const [invoices, creditNotes, items, cancelled] = await Promise.all([
    tx.invoice.findMany({
      where: { businessId, branchId, createdAt: inRange },
      include: { payments: true, order: { select: { type: true } } },
      orderBy: { number: "asc" },
    }),
    tx.creditNote.findMany({
      where: { businessId, invoice: { branchId }, createdAt: inRange },
      include: { refunds: true, invoice: { select: { number: true } } },
      orderBy: { number: "asc" },
    }),
    tx.orderItem.findMany({
      where: { businessId, status: { not: "CANCELLED" }, order: { branchId, invoice: { createdAt: inRange } } },
      select: { name: true, quantity: true, unitPrice: true, complimentary: true },
    }),
    tx.order.findMany({
      where: { businessId, branchId, status: "CANCELLED", closedAt: inRange },
      include: { _count: { select: { items: true } } },
      orderBy: { number: "asc" },
    }),
  ]);
  // Stock is shared across the business, but each sale movement names its invoice, so cost follows the branch that sold it.
  const branchInvoiceIds = invoices.map((i) => i.id);
  const [used, usedOn] = await Promise.all([
    tx.stockMovement.aggregate({
      where: { businessId, kind: "SALE", createdAt: inRange, invoiceId: { in: branchInvoiceIds } },
      _sum: { totalCost: true },
    }),
    // Bills that actually used stock. Sales made before a recipe existed carry no cost and are left out of the share.
    tx.stockMovement.findMany({
      where: { businessId, kind: "SALE", createdAt: inRange, invoiceId: { in: branchInvoiceIds } },
      select: { invoiceId: true },
      distinct: ["invoiceId"],
    }),
  ]);
  const costedInvoiceIds = usedOn.map((m) => m.invoiceId!).filter(Boolean);
  // A line counts toward the cost share when its dish has a recipe, or when it carries an add-on that uses stock
  // (so an extra egg's cost and its sale price are measured together).
  const stockedAddOns = costedInvoiceIds.length
    ? (await tx.addOnStock.findMany({ where: { businessId }, select: { addOnId: true }, distinct: ["addOnId"] })).map((r) => r.addOnId)
    : [];
  const recipeItems = costedInvoiceIds.length
    ? await tx.orderItem.findMany({
        where: {
          businessId,
          status: { not: "CANCELLED" },
          complimentary: false,
          OR: [{ menuItem: { recipe: { some: {} } } }, { addOns: { some: { addOnId: { in: stockedAddOns } } } }],
          order: { invoice: { id: { in: costedInvoiceIds } } },
        },
        select: { quantity: true, unitPrice: true },
      })
    : [];

  return buildReport({
    foodCost: 0 - (used._sum.totalCost ?? 0), // not -(...): that would turn 0 into -0
    recipeSales: recipeItems.reduce((n, i) => n + i.quantity * i.unitPrice, 0),
    invoices: invoices.map((i) => ({
      number: i.number,
      subtotal: i.subtotal,
      discount: i.discount,
      loyaltyDiscount: i.loyaltyDiscount,
      serviceCharge: i.serviceCharge,
      vat: i.vat,
      roundOff: i.roundOff,
      deliveryFee: i.deliveryFee,
      grandTotal: i.grandTotal,
      orderType: i.order.type,
      payments: i.payments.map((p) => ({ method: p.method as Method, amount: p.amount })),
    })),
    creditNotes: creditNotes.map((c) => ({
      number: c.number,
      invoiceNumber: c.invoice.number,
      grandTotal: c.grandTotal,
      vat: c.vat,
      reason: c.reason,
      refunds: c.refunds.map((r) => ({ method: r.method as Method, amount: r.amount })),
    })),
    items,
    cancelled: cancelled.map((o) => ({ number: o.number, reason: o.cancelReason, itemCount: o._count.items })),
  });
}

export async function getDayReport(ctx: TenantContext, requestedDate?: string) {
  needView(ctx);
  const { businessId, branchId } = scope(ctx);
  const business = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const today = localDate(new Date(), business.timezone);
  const date = requestedDate ?? today;
  checkDate(date);

  const { start, end } = dayRange(date, business.timezone);
  const [report, dayClose, openOrders] = await Promise.all([
    db.$transaction((tx) => loadReport(tx, businessId, branchId, business.timezone, date)),
    db.dayClose.findUnique({ where: { branchId_date: { branchId, date } } }),
    db.order.count({ where: { businessId, branchId, status: { in: ["OPEN", "SERVED"] }, createdAt: { lt: end } } }),
  ]);
  const closer = dayClose
    ? await db.user.findUnique({ where: { id: dayClose.closedById }, select: { name: true } })
    : null;
  return { date, today, timezone: business.timezone, range: { start, end }, report, dayClose, closedByName: closer?.name ?? null, openOrders };
}

export async function closeDay(ctx: TenantContext, input: { date: string; countedCash: number; note?: string }) {
  if (!can(ctx, "day.close")) throw new DomainError("You do not have permission to close the day.");
  checkDate(input.date);
  if (!Number.isInteger(input.countedCash) || input.countedCash < 0 || input.countedCash > 100_000_000_00) {
    throw new DomainError("Enter the cash you counted, as an amount of Rs 0 or more.");
  }
  const note = input.note?.trim().slice(0, 300) || null;
  const { branchId } = scope(ctx);

  return db.$transaction(async (tx) => {
    const business = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
    const today = localDate(new Date(), business.timezone);
    if (input.date > today) throw new DomainError("You cannot close a day that has not happened yet.");

    const existing = await tx.dayClose.findUnique({ where: { branchId_date: { branchId, date: input.date } } });
    if (existing) throw new DomainError("That day is already closed.");

    const { end } = dayRange(input.date, business.timezone);
    const open = await tx.order.count({ where: { businessId: ctx.businessId, branchId, status: { in: ["OPEN", "SERVED"] }, createdAt: { lt: end } } });
    if (open > 0) {
      throw new DomainError(`${open} bill${open === 1 ? " is" : "s are"} still open. Pay or cancel ${open === 1 ? "it" : "them"} first.`);
    }

    const report = await loadReport(tx, ctx.businessId, branchId, business.timezone, input.date);
    const expectedCash = report.expectedCash;
    const difference = input.countedCash - expectedCash;
    const row = await tx.dayClose.create({
      data: {
        businessId: ctx.businessId,
        branchId,
        date: input.date,
        closedById: ctx.userId,
        expectedCash,
        countedCash: input.countedCash,
        difference,
        note,
        snapshot: report as unknown as Prisma.InputJsonValue,
      },
    });
    await audit(tx, ctx, "day.close", "DayClose", row.id, { date: input.date, expectedCash, countedCash: input.countedCash, difference });
    return row;
  });
}

/** Owner only: unlock a closed day (to fix a mistake or take a late payment). The old count is kept in the audit log. */
export async function reopenDay(ctx: TenantContext, date: string) {
  if (!can(ctx, "day.reopen")) throw new DomainError("Only the owner can reopen a closed day.");
  checkDate(date);
  const { branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const row = await tx.dayClose.findUnique({ where: { branchId_date: { branchId, date } } });
    if (!row) throw new DomainError("That day is not closed.");
    await tx.dayClose.delete({ where: { id: row.id } });
    await audit(tx, ctx, "day.reopen", "DayClose", row.id, {
      date,
      expectedCash: row.expectedCash,
      countedCash: row.countedCash,
      difference: row.difference,
    });
  });
}

/**
 * Sales across the branches the person works in, for a run of days: each branch's own report and the combined total.
 * Each branch is worked out exactly as its own daily report is, so the combined figures are the sum of the branches'.
 */
export async function getBranchRollup(ctx: TenantContext, range: { from?: string; to?: string } = {}) {
  needView(ctx);
  const business = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const today = localDate(new Date(), business.timezone);
  const to = range.to ?? today;
  const from = range.from ?? to;
  checkDate(from);
  checkDate(to);
  if (from > to) throw new DomainError("The start date must not be after the end date.");
  if (to > addDays(from, 366)) throw new DomainError("Choose a period of a year or less.");
  const branches = await db.branch.findMany({
    where: { businessId: ctx.businessId, id: { in: ctx.branchIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, active: true },
  });
  const reports = await Promise.all(branches.map((b) => db.$transaction((tx) => loadReport(tx, ctx.businessId, b.id, business.timezone, from, to))));
  return {
    from,
    to,
    branches: branches.map((b, i) => ({ ...b, report: reports[i]! })),
    combined: combineReports(reports),
  };
}
