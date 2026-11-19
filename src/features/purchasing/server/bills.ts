import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { isValidDate, localDate } from "@/lib/business-day";
import { billStatus, outstanding, summarizePayables } from "@/features/purchasing/bills";

/**
 * Supplier bills (what suppliers are owed) and the payments against them. Owners and managers only. A bill is never
 * deleted: a wrong one is voided (only while nothing has been paid on it), and a payment is never edited, so the balance
 * can always be explained. Every query is filtered by businessId.
 */

const MAX_PAISA = 100_000_000_000;
const METHODS = ["CASH", "BANK", "QR", "CHEQUE", "OTHER"] as const;
export type PayMethod = (typeof METHODS)[number];

function need(ctx: TenantContext) {
  if (!can(ctx.role, "supplier.pay")) throw new DomainError("You do not have permission to handle supplier bills.");
}

function cleanText(value: string | undefined | null, max: number): string | null {
  const t = (value ?? "").trim().replace(/\s+/g, " ");
  if (t.length > max) throw new DomainError(`That is too long (${max} characters at most).`);
  return t || null;
}

async function today(businessId: string) {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  return localDate(new Date(), b.timezone);
}

export async function createBill(
  ctx: TenantContext,
  input: { supplierId: string; number?: string; billDate: string; dueDate?: string; amount: number; vatAmount?: number; tdsAmount?: number; note?: string; purchaseOrderId?: string },
) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_PAISA) {
    throw new DomainError("Enter the bill amount as a number above zero.");
  }
  const vatAmount = input.vatAmount ?? 0;
  if (!Number.isInteger(vatAmount) || vatAmount < 0 || vatAmount >= input.amount) throw new DomainError("The VAT must be less than the bill total.");
  const tdsAmount = input.tdsAmount ?? 0;
  if (!Number.isInteger(tdsAmount) || tdsAmount < 0 || tdsAmount >= input.amount) throw new DomainError("The tax deducted at source must be less than the bill total.");
  if (!isValidDate(input.billDate)) throw new DomainError("Choose a valid bill date.");
  const dueDate = input.dueDate?.trim() || null;
  if (dueDate && !isValidDate(dueDate)) throw new DomainError("Choose a valid due date.");
  if (dueDate && dueDate < input.billDate) throw new DomainError("The due date cannot be before the bill date.");
  const number = cleanText(input.number, 60);
  const note = cleanText(input.note, 300);

  return db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, businessId } });
    if (!supplier) throw new DomainError("Supplier not found.");
    if (number) {
      const clash = await tx.supplierBill.findFirst({
        where: { businessId, supplierId: supplier.id, number: { equals: number, mode: "insensitive" }, voidedAt: null },
      });
      if (clash) throw new DomainError(`${supplier.name} already has a bill with that number.`);
    }
    if (input.purchaseOrderId) {
      const po = await tx.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, businessId, supplierId: supplier.id } });
      if (!po) throw new DomainError("That purchase order is not for this supplier.");
    }
    const bill = await tx.supplierBill.create({
      data: {
        businessId,
        supplierId: supplier.id,
        branchId,
        number,
        billDate: input.billDate,
        dueDate,
        amount: input.amount,
        vatAmount,
        tdsAmount,
        note,
        purchaseOrderId: input.purchaseOrderId || null,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, "bill.create", "SupplierBill", bill.id, { supplier: supplier.name, number, amount: input.amount });
    return bill;
  });
}

export async function recordBillPayment(
  ctx: TenantContext,
  billId: string,
  input: { amount: number; method: string; paidOn: string; reference?: string; note?: string },
) {
  need(ctx);
  const { businessId } = ctx;
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_PAISA) {
    throw new DomainError("Enter the amount paid as a number above zero.");
  }
  if (!(METHODS as readonly string[]).includes(input.method)) throw new DomainError("Choose how it was paid.");
  if (!isValidDate(input.paidOn)) throw new DomainError("Choose a valid payment date.");
  if (input.paidOn > (await today(businessId))) throw new DomainError("A payment cannot be dated in the future.");
  const reference = cleanText(input.reference, 80);
  const note = cleanText(input.note, 200);

  await db.$transaction(async (tx) => {
    // Lock the bill so two people paying at once cannot together pay more than is owed.
    await tx.$queryRaw`SELECT id FROM "SupplierBill" WHERE id = ${billId} AND "businessId" = ${businessId} FOR UPDATE`;
    const bill = await tx.supplierBill.findFirst({ where: { id: billId, businessId }, include: { supplier: { select: { name: true } } } });
    if (!bill) throw new DomainError("Bill not found.");
    if (bill.voidedAt) throw new DomainError("That bill was voided.");
    if (input.paidOn < bill.billDate) throw new DomainError("A payment cannot be dated before the bill.");
    const paid = (await tx.supplierPayment.aggregate({ where: { businessId, billId }, _sum: { amount: true } }))._sum.amount ?? 0;
    // Tax deducted at source is kept back from the supplier, so it is not part of what is paid to them.
    const left = bill.amount - bill.tdsAmount - paid;
    if (input.amount > left) throw new DomainError(`Only ${(left / 100).toLocaleString("en-US", { minimumFractionDigits: left % 100 ? 2 : 0 })} is still owed on this bill.`);
    const pay = await tx.supplierPayment.create({
      data: { businessId, billId, amount: input.amount, method: input.method as PayMethod, paidOn: input.paidOn, reference, note, createdById: ctx.userId },
    });
    await audit(tx, ctx, "bill.pay", "SupplierPayment", pay.id, { supplier: bill.supplier.name, bill: bill.number, amount: input.amount, method: input.method });
  });
}

/** Cancel a bill entered by mistake. Only possible while nothing has been paid on it; the reason is kept. */
export async function voidBill(ctx: TenantContext, billId: string, reason: string) {
  need(ctx);
  const { businessId } = ctx;
  const why = cleanText(reason, 200);
  if (!why || why.length < 3) throw new DomainError("Say why (a few words).");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "SupplierBill" WHERE id = ${billId} AND "businessId" = ${businessId} FOR UPDATE`;
    const bill = await tx.supplierBill.findFirst({ where: { id: billId, businessId } });
    if (!bill) throw new DomainError("Bill not found.");
    if (bill.voidedAt) throw new DomainError("That bill is already voided.");
    const payments = await tx.supplierPayment.count({ where: { businessId, billId } });
    if (payments > 0) throw new DomainError("Payments have been made on this bill, so it cannot be voided.");
    await tx.supplierBill.update({ where: { businessId_id: { businessId, id: billId } }, data: { voidedAt: new Date(), voidReason: why } });
    await audit(tx, ctx, "bill.void", "SupplierBill", billId, { reason: why });
  });
}

/** Bills newest first, each with what has been paid, what is left and its status. */
export async function listBills(ctx: TenantContext, filter: { supplierId?: string; open?: boolean } = {}) {
  need(ctx);
  const { businessId } = ctx;
  const t = await today(businessId);
  const bills = await db.supplierBill.findMany({
    where: { businessId, ...(filter.supplierId ? { supplierId: filter.supplierId } : {}) },
    include: { supplier: { select: { name: true } }, payments: { orderBy: { paidOn: "asc" } } },
    orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  const rows = bills.map((b) => {
    const paid = b.payments.reduce((n, p) => n + p.amount, 0);
    const state = { amount: b.amount - b.tdsAmount, paid, voided: !!b.voidedAt };
    const left = outstanding(state);
    return {
      ...b,
      paid,
      outstanding: left,
      status: billStatus(state),
      overdue: left > 0 && !!b.dueDate && b.dueDate < t,
    };
  });
  return filter.open ? rows.filter((r) => r.outstanding > 0) : rows;
}

/** What each supplier is owed, how much is overdue and how overdue, plus the totals. */
export async function getPayables(ctx: TenantContext) {
  need(ctx);
  const { businessId } = ctx;
  const t = await today(businessId);
  const [bills, suppliers] = await Promise.all([
    db.supplierBill.findMany({
      where: { businessId, voidedAt: null },
      select: { supplierId: true, amount: true, tdsAmount: true, dueDate: true, payments: { select: { amount: true } } },
    }),
    db.supplier.findMany({ where: { businessId }, select: { id: true, name: true } }),
  ]);
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  const rows = summarizePayables(
    bills.map((b) => ({ supplierId: b.supplierId, amount: b.amount - b.tdsAmount, paid: b.payments.reduce((n, p) => n + p.amount, 0), voided: false, dueDate: b.dueDate })),
    t,
  ).map((r) => ({ ...r, supplier: name.get(r.supplierId) ?? "Supplier" }));
  return {
    today: t,
    rows,
    totals: {
      outstanding: rows.reduce((n, r) => n + r.outstanding, 0),
      overdue: rows.reduce((n, r) => n + r.overdue, 0),
    },
  };
}
