import { formatNpr } from "@/features/billing/calc";
import type { PdfLine } from "@/lib/pdf";

/**
 * What goes on a receipt, a credit note and a kitchen slip, as plain lines of text for a paper that is `cols` characters
 * wide. Pure: the same lines feed the PDF, the printer file (ESC/POS) and the on-screen preview, so they always agree.
 */

export interface LayoutSettings {
  headerLine: string | null;
  footerLine: string;
  showPan: boolean;
  showAddress: boolean;
  showCustomer: boolean;
  kitchenLargeText: boolean;
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  headerLine: null,
  footerLine: "Thank you!",
  showPan: true,
  showAddress: true,
  showCustomer: true,
  kitchenLargeText: true,
};

export const PAPER_LIMITS = { widthMm: [40, 300], heightMm: [50, 2000], marginMm: [0, 20], fontTenthPt: [60, 160] } as const;

/** Keep a number inside a range; a missing or non-numeric value falls back. */
export function clampInt(value: unknown, [lo, hi]: readonly [number, number], fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// --- text helpers -------------------------------------------------------------------

/** Cut text to a width without splitting words where possible. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

export function center(text: string, width: number): string {
  const t = text.length > width ? text.slice(0, width) : text;
  return " ".repeat(Math.floor((width - t.length) / 2)) + t;
}

/** Left text and right text on one line; the left is shortened (with wrapping lines) if they would collide. */
export function row(left: string, right: string, width: number): string[] {
  if (!right) return wrap(left, width);
  const room = width - right.length - 1;
  if (room < 4) return [...wrap(left, width), right.padStart(width)];
  const parts = wrap(left, room);
  const last = parts.length - 1;
  return parts.map((p, i) => (i === last ? p.padEnd(room) + " " + right : p));
}

export const rule = (width: number, ch = "-") => ch.repeat(width);
const money = (n: number) => formatNpr(n);
const neg = (n: number) => `-${formatNpr(n)}`;

// --- receipt ------------------------------------------------------------------------

export interface ReceiptData {
  business: string;
  pan: string | null;
  branch: string;
  address: string | null;
  invoiceNumber: number;
  /** The bill's number with its fiscal year, like 2083/84-12. Shown instead of the plain number when given. */
  label?: string;
  /** The Nepali (Bikram Sambat) date, YYYY-MM-DD. */
  bsDate?: string;
  buyerName?: string | null;
  buyerPan?: string | null;
  /** Set on a reprint: the line that marks it as a copy. */
  copy?: string | null;
  /** Null for a bill made with no connection: it gets its order number when it reaches the server. */
  orderNumber: number | null;
  /** Already formatted in the business's own time zone. */
  when: string;
  where: string;
  customer: string | null;
  lines: { name: string; quantity: number; total: number; complimentary: boolean; note: string | null; addOns: string[] }[];
  subtotal: number;
  discount: number;
  loyaltyDiscount: number;
  serviceCharge: number;
  vat: number;
  deliveryFee: number;
  roundOff: number;
  grandTotal: number;
  payments: { method: string; amount: number }[];
  creditNotes: { number: number; amount: number }[];
}

export function layoutReceipt(d: ReceiptData, s: LayoutSettings, cols: number): PdfLine[] {
  const L: PdfLine[] = [];
  const add = (text: string, o: Omit<PdfLine, "text"> = {}) => L.push({ text, ...o });
  const rows = (left: string, right: string, o: Omit<PdfLine, "text"> = {}) => row(left, right, cols).forEach((t) => add(t, o));

  wrap(d.business, Math.floor(cols / 2)).forEach((t) => add(center(t, Math.floor(cols / 2)), { bold: true, size: 2 }));
  add(center(d.branch, cols));
  if (s.showAddress && d.address) wrap(d.address, cols).forEach((t) => add(center(t, cols)));
  if (s.headerLine) wrap(s.headerLine, cols).forEach((t) => add(center(t, cols)));
  if (s.showPan && d.pan) add(center(`PAN: ${d.pan}`, cols));
  add(rule(cols));
  add(center("TAX INVOICE", cols), { bold: true });
  if (d.copy) add(center(d.copy, cols), { bold: true });
  rows(`Invoice #${d.label ?? d.invoiceNumber}`, d.orderNumber === null ? "Offline sale" : `Order #${d.orderNumber}`);
  add(d.when);
  if (d.bsDate) add(`Miti: ${d.bsDate} BS`);
  if (d.buyerName) wrap(`Buyer: ${d.buyerName}`, cols).forEach((t) => add(t));
  if (d.buyerPan) add(`Buyer PAN: ${d.buyerPan}`);
  add(d.where);
  if (s.showCustomer && d.customer) rows(`Customer: ${d.customer}`, "");
  add(rule(cols));
  for (const l of d.lines) {
    rows(`${l.quantity} x ${l.name}`, l.complimentary ? "free" : money(l.total));
    if (l.addOns.length) wrap(`+ ${l.addOns.join(", ")}`, cols - 2).forEach((t) => add(`  ${t}`));
    if (l.note) wrap(`(${l.note})`, cols - 2).forEach((t) => add(`  ${t}`));
  }
  add(rule(cols));
  rows("Subtotal", money(d.subtotal));
  if (d.discount > 0) rows("Discount", neg(d.discount));
  if (d.loyaltyDiscount > 0) rows("Reward discount", neg(d.loyaltyDiscount));
  if (d.serviceCharge > 0) rows("Service charge", money(d.serviceCharge));
  if (d.vat > 0) rows("VAT", money(d.vat));
  if (d.deliveryFee > 0) rows("Delivery fee", money(d.deliveryFee));
  if (d.roundOff !== 0) rows("Round off", money(d.roundOff));
  add(rule(cols));
  rows("TOTAL", money(d.grandTotal), { bold: true });
  add(rule(cols));
  for (const p of d.payments) rows(`Paid by ${p.method.toLowerCase()}`, money(p.amount));
  if (d.creditNotes.length) {
    add(rule(cols));
    for (const c of d.creditNotes) rows(`Refunded (credit note #${c.number})`, neg(c.amount));
  }
  add(rule(cols));
  if (s.footerLine) wrap(s.footerLine, cols).forEach((t) => add(center(t, cols)));
  return L;
}

// --- credit note --------------------------------------------------------------------

export interface CreditNoteData {
  business: string;
  pan: string | null;
  branch: string;
  number: number;
  invoiceNumber: number;
  label?: string;
  invoiceLabel?: string;
  bsDate?: string;
  buyerName?: string | null;
  buyerPan?: string | null;
  when: string;
  partial: boolean;
  subtotal: number;
  discount: number;
  loyaltyDiscount: number;
  serviceCharge: number;
  vat: number;
  roundOff: number;
  grandTotal: number;
  refunds: { method: string; amount: number }[];
  reason: string;
}

export function layoutCreditNote(d: CreditNoteData, s: LayoutSettings, cols: number): PdfLine[] {
  const L: PdfLine[] = [];
  const add = (text: string, o: Omit<PdfLine, "text"> = {}) => L.push({ text, ...o });
  const rows = (left: string, right: string, o: Omit<PdfLine, "text"> = {}) => row(left, right, cols).forEach((t) => add(t, o));
  wrap(d.business, Math.floor(cols / 2)).forEach((t) => add(center(t, Math.floor(cols / 2)), { bold: true, size: 2 }));
  add(center(d.branch, cols));
  if (s.showPan && d.pan) add(center(`PAN: ${d.pan}`, cols));
  add(rule(cols));
  add(center(`CREDIT NOTE #${d.label ?? d.number}`, cols), { bold: true });
  rows(`For invoice #${d.invoiceLabel ?? d.invoiceNumber}`, d.partial ? "part refund" : "final");
  add(d.when);
  if (d.bsDate) add(`Miti: ${d.bsDate} BS`);
  if (d.buyerName) wrap(`Buyer: ${d.buyerName}`, cols).forEach((t) => add(t));
  if (d.buyerPan) add(`Buyer PAN: ${d.buyerPan}`);
  add(rule(cols));
  rows("Subtotal", money(d.subtotal));
  if (d.discount > 0) rows("Discount", neg(d.discount));
  if (d.loyaltyDiscount > 0) rows("Reward discount", neg(d.loyaltyDiscount));
  if (d.serviceCharge > 0) rows("Service charge", money(d.serviceCharge));
  if (d.vat > 0) rows("VAT", money(d.vat));
  if (d.roundOff !== 0) rows("Round off", money(d.roundOff));
  add(rule(cols));
  rows("REFUNDED", money(d.grandTotal), { bold: true });
  for (const r of d.refunds) rows(`Back by ${r.method.toLowerCase()}`, money(r.amount));
  add(rule(cols));
  wrap(`Reason: ${d.reason}`, cols).forEach((t) => add(t));
  add("");
  add("Customer signature: ____________");
  return L;
}

// --- kitchen slip -------------------------------------------------------------------

export interface KitchenData {
  branch: string;
  /** "Table 4", "Takeaway" ... */
  title: string;
  number: number;
  time: string;
  note: string | null;
  groups: { station: string; items: { quantity: number; name: string; note: string | null; addOns: string[] }[] }[];
}

export function layoutKitchen(d: KitchenData, s: LayoutSettings, cols: number): PdfLine[] {
  const L: PdfLine[] = [];
  const add = (text: string, o: Omit<PdfLine, "text"> = {}) => L.push({ text, ...o });
  const big = s.kitchenLargeText ? 2 : 1;
  const bigCols = Math.max(8, Math.floor(cols / big));
  wrap(`${d.title} #${d.number}`, bigCols).forEach((t) => add(center(t, bigCols), { bold: true, size: big }));
  add(center(`${d.branch} - ${d.time}`, cols));
  if (d.note) wrap(`NOTE: ${d.note}`, cols).forEach((t) => add(t, { bold: true }));
  if (d.groups.length === 0) add("Nothing to cook.");
  for (const g of d.groups) {
    add(rule(cols));
    add(g.station.toUpperCase(), { bold: true });
    for (const i of g.items) {
      wrap(`${i.quantity} x ${i.name}`, bigCols).forEach((t) => add(t, { bold: true, size: big }));
      if (i.addOns.length) wrap(`+ ${i.addOns.join(", ")}`, cols - 3).forEach((t) => add(`   ${t}`));
      if (i.note) wrap(`** ${i.note} **`, cols - 3).forEach((t) => add(`   ${t}`, { bold: true }));
    }
  }
  return L;
}
