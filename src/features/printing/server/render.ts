import type { TenantContext } from "@/server/auth";
import { buildPdf, charsPerLine, type PdfLine } from "@/lib/pdf";
import { buildEscPos, printerColumns } from "@/lib/escpos";
import { DomainError } from "@/server/errors";
import { getCreditNote, getKitchenSlip, getReceipt } from "./documents";
import { getPrintConfig, paperFor, type PrintConfig } from "./settings";
import { layoutCreditNote, layoutKitchen, layoutReceipt, type CreditNoteData, type KitchenData, type ReceiptData } from "../layout";

/**
 * Turns a stored bill, credit note or order into printable lines, then into a PDF, printer bytes or plain text. One path
 * for all outputs, so a PDF, a printer file and the on-screen preview always show the same thing.
 */

export type DocKind = "invoice" | "credit-note" | "kitchen";
export type DocFormat = "pdf" | "escpos" | "text";

export function isDocKind(v: string): v is DocKind {
  return v === "invoice" || v === "credit-note" || v === "kitchen";
}

const TYPE: Record<string, string> = { DINE_IN: "Dine in", TAKEAWAY: "Takeaway", DELIVERY: "Delivery", QUICK_BILL: "Quick bill" };

const fmtWhen = (d: Date, tz: string) => d.toLocaleString("en-GB", { timeZone: tz, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** The lines of a document for paper `cols` characters wide, plus a file name. */
export async function documentLines(
  ctx: TenantContext,
  kind: DocKind,
  id: string,
  cols: number,
  cfg: PrintConfig,
  opts: { onlyUnprinted?: boolean } = {},
): Promise<{ lines: PdfLine[]; name: string; itemIds: string[] }> {
  if (kind === "invoice") {
    const r = await getReceipt(ctx, id);
    const inv = r.invoice;
    const data: ReceiptData = {
      business: r.business,
      pan: r.pan,
      branch: r.branch,
      address: r.address,
      invoiceNumber: inv.number,
      label: r.label,
      bsDate: r.bsDate,
      buyerName: inv.buyerName,
      buyerPan: inv.buyerPan,
      copy: r.copy,
      orderNumber: r.orderNumber,
      when: fmtWhen(inv.createdAt, r.timezone),
      where: r.where,
      customer: r.customer,
      lines: r.lines,
      subtotal: inv.subtotal,
      discount: inv.discount,
      loyaltyDiscount: inv.loyaltyDiscount,
      serviceCharge: inv.serviceCharge,
      vat: inv.vat,
      deliveryFee: inv.deliveryFee,
      roundOff: inv.roundOff,
      grandTotal: inv.grandTotal,
      payments: inv.payments.map((p) => ({ method: p.method, amount: p.amount })),
      creditNotes: inv.creditNotes.map((c) => ({ number: c.number, amount: c.grandTotal })),
    };
    return { lines: layoutReceipt(data, cfg, cols), name: `receipt-${inv.number}`, itemIds: [] };
  }
  if (kind === "credit-note") {
    const r = await getCreditNote(ctx, id);
    const n = r.note;
    const data: CreditNoteData = {
      business: r.business,
      pan: r.pan,
      branch: r.branch,
      number: n.number,
      invoiceNumber: n.invoice.number,
      label: r.label,
      invoiceLabel: r.invoiceLabel,
      bsDate: r.bsDate,
      buyerName: r.buyerName,
      buyerPan: r.buyerPan,
      when: fmtWhen(n.createdAt, r.timezone),
      partial: n.partial,
      subtotal: n.subtotal,
      discount: n.discount,
      loyaltyDiscount: n.loyaltyDiscount,
      serviceCharge: n.serviceCharge,
      vat: n.vat,
      roundOff: n.roundOff,
      grandTotal: n.grandTotal,
      refunds: n.refunds.map((x) => ({ method: x.method, amount: x.amount })),
      reason: n.reason,
    };
    return { lines: layoutCreditNote(data, cfg, cols), name: `credit-note-${n.number}`, itemIds: [] };
  }
  const k = await getKitchenSlip(ctx, id, { onlyUnprinted: opts.onlyUnprinted });
  const data: KitchenData = {
    branch: k.branch,
    title: k.table ?? TYPE[k.type] ?? k.type,
    number: k.number,
    time: k.createdAt.toLocaleTimeString("en-GB", { timeZone: k.timezone, hour: "2-digit", minute: "2-digit" }),
    note: k.note,
    groups: k.groups.map((g) => ({ station: g.station, items: g.items.map((i) => ({ quantity: i.quantity, name: i.name, note: i.note, addOns: i.addOns })) })),
  };
  return { lines: layoutKitchen(data, cfg, cols), name: `kitchen-${k.number}`, itemIds: k.groups.flatMap((g) => g.items.map((i) => i.id)) };
}

/** One finished file: the bytes, what to call it and how to serve it. */
export async function renderDocument(
  ctx: TenantContext,
  kind: DocKind,
  id: string,
  format: DocFormat,
  overrides: { w?: unknown; h?: unknown } = {},
  opts: { onlyUnprinted?: boolean } = {},
) {
  const cfg = await getPrintConfig(ctx.businessId);
  const page = paperFor(cfg, overrides);
  if (format === "escpos") {
    const { lines, name } = await documentLines(ctx, kind, id, printerColumns(page.widthMm), cfg, opts);
    return { bytes: buildEscPos(lines), type: "application/octet-stream", file: `${name}.bin`, lines };
  }
  const { lines, name } = await documentLines(ctx, kind, id, charsPerLine(page), cfg, opts);
  if (format === "text") return { bytes: new TextEncoder().encode(lines.map((l) => l.text).join("\n") + "\n"), type: "text/plain; charset=utf-8", file: `${name}.txt`, lines };
  if (lines.length === 0) throw new DomainError("There is nothing to print.");
  return { bytes: buildPdf(lines, page), type: "application/pdf", file: `${name}.pdf`, lines };
}
