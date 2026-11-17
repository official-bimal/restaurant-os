import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { getPurchaseOrder } from "@/features/purchasing/server/service";
import { priceVariance, proportionalEstimate, remaining } from "@/features/purchasing/purchasing";
import { formatNpr } from "@/features/billing/calc";
import { cancelOrderAction, closeShortAction, markOrderedAction, receiveAction } from "../actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const STATUS = { DRAFT: "Draft", ORDERED: "Ordered", RECEIVED: "Received", CANCELLED: "Cancelled" } as const;

export default async function PurchaseOrderPage({ params, searchParams }: PageProps<"/stock/orders/[id]">) {
  const ctx = await requireTenant("stock.view");
  const { id } = await params;
  const { error } = await searchParams;
  let po;
  try {
    po = await getPurchaseOrder(ctx, id);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const manage = can(ctx.role, "stock.manage");
  const estimated = po.lines.reduce((n, l) => n + l.estimatedTotal, 0);
  const paid = po.lines.reduce((n, l) => n + l.paidTotal, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/stock/orders" className="text-sm text-stone-500 hover:underline">
          ← Purchase orders
        </Link>
        <h1 className="text-xl font-semibold">Order #{po.number}</h1>
        <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs">{STATUS[po.status]}</span>
        <span className="text-sm text-stone-600">{po.supplier.name}</span>
        {po.expectedOn && <span className="text-sm text-stone-500">needed by {po.expectedOn}</span>}
      </div>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {po.closeNote && (
        <p className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
          {po.status === "CANCELLED" ? "Cancelled" : "Closed short"}: {po.closeNote}
        </p>
      )}
      {po.note && <p className="text-sm text-stone-600">Note: {po.note}</p>}

      <section className="overflow-x-auto rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="text-stone-500">
            <tr>
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="py-2 pr-3 text-right font-medium">Ordered</th>
              <th className="py-2 pr-3 text-right font-medium">Arrived</th>
              <th className="py-2 pr-3 text-right font-medium">Expected price</th>
              <th className="py-2 pr-3 text-right font-medium">Paid</th>
              <th className="py-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {po.lines.map((l) => {
              const v = priceVariance(l);
              return (
                <tr key={l.id}>
                  <td className="py-2 pr-3 font-medium">{l.stockItem.name}</td>
                  <td className="py-2 pr-3 text-right">
                    {l.quantityOrdered.toLocaleString("en-GB")} {l.stockItem.unit}
                  </td>
                  <td className="py-2 pr-3 text-right">{l.quantityReceived.toLocaleString("en-GB")}</td>
                  <td className="py-2 pr-3 text-right">{formatNpr(l.estimatedTotal)}</td>
                  <td className="py-2 pr-3 text-right">{l.paidTotal > 0 ? formatNpr(l.paidTotal) : "-"}</td>
                  <td className={`py-2 text-right ${v > 0 ? "text-red-700" : v < 0 ? "text-green-800" : ""}`}>
                    {l.quantityReceived > 0 ? `${v > 0 ? "+" : ""}${formatNpr(v)}` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-stone-200 font-semibold">
              <td className="py-2 pr-3">Total</td>
              <td />
              <td />
              <td className="py-2 pr-3 text-right">{formatNpr(estimated)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(paid)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      {(po.status === "DRAFT" || po.status === "ORDERED") && (
        <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <h2 className="font-semibold">The order to send</h2>
          <textarea readOnly rows={Math.min(10, po.text.split("\n").length + 1)} value={po.text} aria-label="Order text" className="mt-2 w-full rounded-lg border border-stone-300 bg-stone-50 p-2 text-sm" />
          <p className="mt-1 text-xs text-stone-500">Copy this and send it to the supplier yourself. The app does not send it.</p>
          {po.supplier.phone && (
            <a
              href={`sms:${po.supplier.phone}?body=${encodeURIComponent(po.text)}`}
              className="mt-2 inline-flex min-h-9 items-center rounded-lg border border-stone-300 px-3 text-sm"
            >
              Open in messages ({po.supplier.phone})
            </a>
          )}
        </section>
      )}

      {manage && po.status === "DRAFT" && (
        <section className="flex flex-wrap items-start gap-4">
          <form action={markOrderedAction.bind(null, po.id)}>
            <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">I have placed this order</button>
          </form>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-red-700">Cancel this draft</summary>
            <form action={cancelOrderAction.bind(null, po.id)} className="mt-2 text-sm">
              <input type="hidden" name="reason" value="" />
              <button className="min-h-9 rounded-lg bg-red-700 px-3 text-white">Yes, cancel it</button>
            </form>
          </details>
        </section>
      )}

      {manage && po.status === "ORDERED" && (
        <>
          <form action={receiveAction.bind(null, po.id)} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
            <h2 className="font-semibold">A delivery arrived</h2>
            <p className="text-sm text-stone-600">Enter what arrived and what you paid for it. Leave 0 for items that did not come.</p>
            <ul className="mt-3 space-y-2 text-sm">
              {po.lines
                .filter((l) => remaining(l) > 0)
                .map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-40 flex-1 font-medium">
                      {l.stockItem.name} <span className="font-normal text-stone-500">(up to {remaining(l).toLocaleString("en-GB")} {l.stockItem.unit})</span>
                    </span>
                    <label className="text-xs text-stone-600">
                      Arrived
                      <input name={`qty_${l.id}`} type="number" min={0} max={remaining(l)} defaultValue={remaining(l)} className="ml-1 w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-right" />
                    </label>
                    <label className="text-xs text-stone-600">
                      Paid (Rs)
                      <input
                        name={`paid_${l.id}`}
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={(proportionalEstimate(l.estimatedTotal, l.quantityOrdered, remaining(l)) / 100).toFixed(2)}
                        className="ml-1 w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-right"
                      />
                    </label>
                  </li>
                ))}
            </ul>
            <button className="mt-3 min-h-11 rounded-lg bg-green-700 px-4 font-medium text-white">Add to stock</button>
          </form>

          <section className="flex flex-wrap items-start gap-6">
            <details>
              <summary className="cursor-pointer text-sm font-medium">Close as received, with items missing</summary>
              <form action={closeShortAction.bind(null, po.id)} className="mt-2 space-y-2 text-sm">
                <label className="block font-medium">
                  Why is the rest not coming?
                  <input name="reason" required minLength={3} maxLength={200} className={input} />
                </label>
                <button className="min-h-9 rounded-lg border border-stone-300 px-3">Close order</button>
              </form>
            </details>
            <details>
              <summary className="cursor-pointer text-sm font-medium text-red-700">Cancel this order</summary>
              <form action={cancelOrderAction.bind(null, po.id)} className="mt-2 space-y-2 text-sm">
                <label className="block font-medium">
                  Why?
                  <input name="reason" required minLength={3} maxLength={200} className={input} />
                </label>
                <button className="min-h-9 rounded-lg bg-red-700 px-3 text-white">Cancel order</button>
              </form>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
