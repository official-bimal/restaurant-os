import { notFound } from "next/navigation";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { getCreditNote } from "@/features/printing/server/documents";
import { paperWidth } from "@/features/printing/receipt";
import { formatNpr } from "@/features/billing/calc";
import { PrintShell, Row, Rule } from "@/components/print-shell";

export const dynamic = "force-dynamic";

export default async function PrintCreditNote({ params, searchParams }: PageProps<"/print/credit-note/[id]">) {
  const ctx = await requireTenant();
  const { id } = await params;
  const q = await searchParams;
  let r;
  try {
    r = await getCreditNote(ctx, id);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const n = r.note;
  const when = n.createdAt.toLocaleString("en-GB", { timeZone: r.timezone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <PrintShell width={paperWidth(q.w)} auto={q.auto === "1"}>
      <div className="text-center">
        <div className="text-[14px] font-bold">{r.business}</div>
        <div>{r.branch}</div>
        {r.pan && <div>PAN: {r.pan}</div>}
      </div>
      <Rule />
      <div className="text-center font-bold">CREDIT NOTE #{r.label}</div>
      <Row left={`For invoice #${r.invoiceLabel}`} right={n.partial ? "part refund" : "final"} />
      <div>{when}</div>
      <div>Miti: {r.bsDate} BS</div>
      {r.buyerName && <div>Buyer: {r.buyerName}</div>}
      {r.buyerPan && <div>Buyer PAN: {r.buyerPan}</div>}
      <Rule />
      <Row left="Subtotal" right={formatNpr(n.subtotal)} />
      {n.discount > 0 && <Row left="Discount" right={`-${formatNpr(n.discount)}`} />}
      {n.loyaltyDiscount > 0 && <Row left="Reward discount" right={`-${formatNpr(n.loyaltyDiscount)}`} />}
      {n.serviceCharge > 0 && <Row left="Service charge" right={formatNpr(n.serviceCharge)} />}
      {n.vat > 0 && <Row left="VAT" right={formatNpr(n.vat)} />}
      {n.roundOff !== 0 && <Row left="Round off" right={formatNpr(n.roundOff)} />}
      <Rule />
      <Row bold left="REFUNDED" right={formatNpr(n.grandTotal)} />
      {n.refunds.map((p) => (
        <Row key={p.id} left={`Back by ${p.method.toLowerCase()}`} right={formatNpr(p.amount)} />
      ))}
      <Rule />
      <div>Reason: {n.reason}</div>
      <div className="mt-6">Customer signature: ____________</div>
    </PrintShell>
  );
}
