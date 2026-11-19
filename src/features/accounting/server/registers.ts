import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { dayRange, isValidDate } from "@/lib/business-day";
import { billDates, invoiceLabel, taxSplit } from "@/features/billing/ird";
import { toBs } from "../fiscal";

/**
 * The statutory books for VAT: the sales book (every bill and credit note), the purchase book (supplier bills) and the monthly VAT summary
 * in Nepali months. Read-only, for owners and managers. Columns follow the sales and purchase books IRD asks VAT-registered businesses to keep
 * (bill date in BS, bill number, name and PAN, total, non-taxable, taxable, VAT); an item-by-item listing is not included.
 */

function need(ctx: TenantContext) {
  if (!can(ctx.role, "books.view")) throw new DomainError("You do not have permission to see the accounts.");
}

function check(from: string, to: string) {
  if (!isValidDate(from) || !isValidDate(to)) throw new DomainError("Choose valid dates.");
  if (from > to) throw new DomainError("The start date is after the end date.");
}

export interface BookRow {
  kind: "INVOICE" | "CREDIT_NOTE" | "PURCHASE";
  /** English date, YYYY-MM-DD, and the Nepali date. */
  date: string;
  bs: string;
  number: string;
  name: string | null;
  pan: string | null;
  /** Credit notes and purchase returns are negative. */
  total: number;
  nonTaxable: number;
  taxable: number;
  vat: number;
  /** Anything worth knowing about the row (the invoice a credit note is for). */
  note: string | null;
}

const bsOf = (date: string) => {
  const b = toBs(date);
  return `${b.year}-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`;
};

export async function getSalesBook(ctx: TenantContext, from: string, to: string): Promise<{ rows: BookRow[]; totals: Totals }> {
  need(ctx);
  check(from, to);
  const biz = await db.business.findUniqueOrThrow({
    where: { id: ctx.businessId },
    select: { timezone: true, vatAppliesToServiceCharge: true, vatOnDeliveryFee: true },
  });
  const { start } = dayRange(from, biz.timezone);
  const { end } = dayRange(to, biz.timezone);
  const rules = { vatAppliesToServiceCharge: biz.vatAppliesToServiceCharge, vatOnDeliveryFee: biz.vatOnDeliveryFee };
  const [invoices, notes] = await Promise.all([
    db.invoice.findMany({ where: { businessId: ctx.businessId, createdAt: { gte: start, lt: end } }, orderBy: { createdAt: "asc" }, take: 20000 }),
    db.creditNote.findMany({ where: { businessId: ctx.businessId, createdAt: { gte: start, lt: end } }, orderBy: { createdAt: "asc" }, include: { invoice: true }, take: 20000 }),
  ]);
  const rows: BookRow[] = [];
  for (const i of invoices) {
    const d = billDates(i.createdAt, biz.timezone);
    const t = taxSplit(i, rules);
    rows.push({ kind: "INVOICE", date: d.date, bs: d.bs, number: invoiceLabel(d.fiscalYear, i.number), name: i.buyerName, pan: i.buyerPan, total: i.grandTotal, nonTaxable: t.nonTaxable, taxable: t.taxable, vat: t.vat, note: null });
  }
  for (const n of notes) {
    const d = billDates(n.createdAt, biz.timezone);
    const was = billDates(n.invoice.createdAt, biz.timezone);
    const t = taxSplit({ grandTotal: n.grandTotal, serviceCharge: n.serviceCharge, vat: n.vat, deliveryFee: 0 }, rules);
    rows.push({
      kind: "CREDIT_NOTE",
      date: d.date,
      bs: d.bs,
      number: `CN ${invoiceLabel(d.fiscalYear, n.number)}`,
      name: n.invoice.buyerName,
      pan: n.invoice.buyerPan,
      total: -n.grandTotal,
      nonTaxable: -t.nonTaxable,
      taxable: -t.taxable,
      vat: -t.vat,
      note: `For invoice ${invoiceLabel(was.fiscalYear, n.invoice.number)}`,
    });
  }
  rows.sort((a, b) => (a.date === b.date ? (a.kind === b.kind ? 0 : a.kind === "INVOICE" ? -1 : 1) : a.date < b.date ? -1 : 1));
  return { rows, totals: sum(rows) };
}

export async function getPurchaseBook(ctx: TenantContext, from: string, to: string): Promise<{ rows: BookRow[]; totals: Totals }> {
  need(ctx);
  check(from, to);
  const bills = await db.supplierBill.findMany({
    where: { businessId: ctx.businessId, voidedAt: null, billDate: { gte: from, lte: to } },
    include: { supplier: { select: { name: true, panNumber: true } } },
    orderBy: [{ billDate: "asc" }, { createdAt: "asc" }],
    take: 20000,
  });
  const rows: BookRow[] = bills.map((b) => ({
    kind: "PURCHASE",
    date: b.billDate,
    bs: bsOf(b.billDate),
    number: b.number ?? "(no number)",
    name: b.supplier.name,
    pan: b.supplier.panNumber,
    total: b.amount,
    nonTaxable: b.vatAmount === 0 ? b.amount : 0,
    taxable: b.vatAmount === 0 ? 0 : b.amount - b.vatAmount,
    vat: b.vatAmount,
    note: null,
  }));
  return { rows, totals: sum(rows) };
}

export interface Totals {
  total: number;
  nonTaxable: number;
  taxable: number;
  vat: number;
}

function sum(rows: BookRow[]): Totals {
  return rows.reduce((t, r) => ({ total: t.total + r.total, nonTaxable: t.nonTaxable + r.nonTaxable, taxable: t.taxable + r.taxable, vat: t.vat + r.vat }), { total: 0, nonTaxable: 0, taxable: 0, vat: 0 });
}

export interface VatMonth {
  /** "2083-04" */
  month: string;
  monthName: string;
  taxableSales: number;
  outputVat: number;
  taxablePurchases: number;
  inputVat: number;
  /** Output VAT less input VAT: positive is payable to IRD, negative is carried forward. */
  net: number;
}

const BS_MONTHS = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];

/** VAT by Nepali month for a period. Sales are net of credit notes. */
export async function getVatSummary(ctx: TenantContext, from: string, to: string): Promise<{ months: VatMonth[]; totals: Omit<VatMonth, "month" | "monthName"> }> {
  const [sales, purchases] = await Promise.all([getSalesBook(ctx, from, to), getPurchaseBook(ctx, from, to)]);
  const by = new Map<string, VatMonth>();
  const at = (date: string) => {
    const b = toBs(date);
    const key = `${b.year}-${String(b.month).padStart(2, "0")}`;
    let m = by.get(key);
    if (!m) by.set(key, (m = { month: key, monthName: `${BS_MONTHS[b.month - 1]} ${b.year}`, taxableSales: 0, outputVat: 0, taxablePurchases: 0, inputVat: 0, net: 0 }));
    return m;
  };
  for (const r of sales.rows) {
    const m = at(r.date);
    m.taxableSales += r.taxable;
    m.outputVat += r.vat;
  }
  for (const r of purchases.rows) {
    const m = at(r.date);
    m.taxablePurchases += r.taxable;
    m.inputVat += r.vat;
  }
  const months = [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const m of months) m.net = m.outputVat - m.inputVat;
  const totals = months.reduce(
    (t, m) => ({ taxableSales: t.taxableSales + m.taxableSales, outputVat: t.outputVat + m.outputVat, taxablePurchases: t.taxablePurchases + m.taxablePurchases, inputVat: t.inputVat + m.inputVat, net: t.net + m.net }),
    { taxableSales: 0, outputVat: 0, taxablePurchases: 0, inputVat: 0, net: 0 },
  );
  return { months, totals };
}

/** The audit trail: who did what, newest first. Owners and managers. */
export async function getAuditTrail(ctx: TenantContext, filter: { from: string; to: string; action?: string }) {
  need(ctx);
  check(filter.from, filter.to);
  const biz = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const { start } = dayRange(filter.from, biz.timezone);
  const { end } = dayRange(filter.to, biz.timezone);
  const events = await db.auditEvent.findMany({
    where: { businessId: ctx.businessId, createdAt: { gte: start, lt: end }, ...(filter.action ? { action: { startsWith: filter.action } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.userId).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return events.map((e) => ({ id: e.id, at: e.createdAt, who: e.userId ? (names.get(e.userId) ?? "Unknown") : "System", action: e.action, entity: e.entity, entityId: e.entityId, detail: e.detail }));
}

/** CSV text for a book, with a header row. Values that start with a spreadsheet formula character are made safe. */
export function booksCsv(rows: BookRow[], party: string): string {
  const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const q = (v: string | number | null) => {
    const t = v === null ? "" : typeof v === "number" ? String(v) : safe(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rs = (n: number) => Number((n / 100).toFixed(2));
  const head = ["Date (BS)", "Date (AD)", "Bill no.", party, "PAN", "Total", "Non-taxable", "Taxable amount", "VAT", "Note"];
  const lines = rows.map((r) => [r.bs, r.date, r.number, r.name, r.pan, rs(r.total), rs(r.nonTaxable), rs(r.taxable), rs(r.vat), r.note].map((v) => q(v as string | number | null)).join(","));
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
