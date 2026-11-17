import { notFound } from "next/navigation";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { getReceipt } from "@/features/printing/server/documents";
import { paperWidth } from "@/features/printing/receipt";
import { formatNpr } from "@/features/billing/calc";
import { PrintShell, Row, Rule } from "@/components/print-shell";

export const dynamic = "force-dynamic";

export default async function PrintInvoice({ params, searchParams }: PageProps<"/print/invoice/[id]">) {
  const ctx = await requireTenant();
  const { id } = await params;
  const q = await searchParams;
  let r;
  try {
    r = await getReceipt(ctx, id);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const inv = r.invoice;
  const when = inv.createdAt.toLocaleString("en-GB", { timeZone: r.timezone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <PrintShell width={paperWidth(q.w)} auto={q.auto === "1"}>
      <div className="text-center">
        <div className="text-[14px] font-bold">{r.business}</div>
        <div>{r.branch}</div>
        {r.address && <div>{r.address}</div>}
        {r.pan && <div>PAN: {r.pan}</div>}
      </div>
      <Rule />
      <Row left={`Invoice #${inv.number}`} right={`Order #${r.orderNumber}`} />
      <div>{when}</div>
      <div>{r.where}</div>
      {r.customer && <div>Customer: {r.customer}</div>}
      <Rule />
      {r.lines.map((l, i) => (
        <div key={i} className="mb-1">
          <Row left={`${l.quantity} x ${l.name}`} right={l.complimentary ? "free" : formatNpr(l.total)} />
          {l.addOns.length > 0 && <div className="pl-3">+ {l.addOns.join(", ")}</div>}
          {l.note && <div className="pl-3">({l.note})</div>}
        </div>
      ))}
      <Rule />
      <Row left="Subtotal" right={formatNpr(inv.subtotal)} />
      {inv.discount > 0 && <Row left="Discount" right={`-${formatNpr(inv.discount)}`} />}
      {inv.loyaltyDiscount > 0 && <Row left="Reward discount" right={`-${formatNpr(inv.loyaltyDiscount)}`} />}
      {inv.serviceCharge > 0 && <Row left="Service charge" right={formatNpr(inv.serviceCharge)} />}
      {inv.vat > 0 && <Row left="VAT" right={formatNpr(inv.vat)} />}
      {inv.deliveryFee > 0 && <Row left="Delivery fee" right={formatNpr(inv.deliveryFee)} />}
      {inv.roundOff !== 0 && <Row left="Round off" right={formatNpr(inv.roundOff)} />}
      <Rule />
      <Row bold left="TOTAL" right={formatNpr(inv.grandTotal)} />
      <Rule />
      {inv.payments.map((p) => (
        <Row key={p.id} left={`Paid by ${p.method.toLowerCase()}`} right={formatNpr(p.amount)} />
      ))}
      {r.refunded > 0 && (
        <>
          <Rule />
          {inv.creditNotes.map((c) => (
            <Row key={c.id} left={`Refunded (credit note #${c.number})`} right={`-${formatNpr(c.grandTotal)}`} />
          ))}
        </>
      )}
      <Rule />
      <div className="text-center">Thank you!</div>
    </PrintShell>
  );
}
