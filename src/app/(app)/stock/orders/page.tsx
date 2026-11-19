import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { listStock } from "@/features/stock/server/service";
import { listPurchaseOrders, listSuppliers, suggestedLines } from "@/features/purchasing/server/service";
import { formatNpr } from "@/features/billing/calc";
import {
  archiveSupplierAction,
  createOrderAction,
  createSupplierAction,
  draftFromLowStockAction,
} from "./actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const STATUS = {
  DRAFT: { label: "Draft", cls: "bg-stone-100 text-stone-700" },
  ORDERED: { label: "Ordered", cls: "bg-blue-100 text-blue-800" },
  RECEIVED: { label: "Received", cls: "bg-green-100 text-green-800" },
  CANCELLED: { label: "Cancelled", cls: "bg-red-100 text-red-800" },
} as const;

export default async function PurchaseOrdersPage({ searchParams }: PageProps<"/stock/orders">) {
  const ctx = await requireTenant("stock.view");
  const { error, fill } = await searchParams;
  const manage = can(ctx.role, "stock.manage");
  const [orders, suppliers, items, suggestions] = await Promise.all([
    listPurchaseOrders(ctx),
    listSuppliers(ctx),
    listStock(ctx),
    suggestedLines(ctx),
  ]);
  const suggested = new Map(suggestions.map((s) => [s.stockItemId, s.quantity]));
  const prefill = fill === "low";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/stock" className="text-sm text-stone-500 hover:underline">
          ← Stock
        </Link>
        <h1 className="text-xl font-semibold">Purchase orders</h1>
      </div>

      <p className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
        Write an order, pass it to your supplier yourself (call, message or in person), then mark it ordered. When the goods
        arrive, record them here and stock and costs update. The app does not contact suppliers.
      </p>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {manage && suggestions.length > 0 && (
        <section className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <h2 className="font-semibold">Running low</h2>
          <p className="text-sm text-amber-900">
            {suggestions.map((s) => `${s.name} (${s.onHand.toLocaleString("en-GB")} ${s.unit}${s.onOrder > 0 ? `, ${s.onOrder.toLocaleString("en-GB")} on order` : ""})`).join(", ")}
          </p>
          {suppliers.length > 0 && (
            <form action={draftFromLowStockAction} className="mt-2 flex flex-wrap items-end gap-2 text-sm">
              <label className="font-medium">
                Supplier
                <select name="supplierId" className="mt-1 block rounded-lg border border-stone-300 px-2 py-2">
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Draft an order for these</button>
            </form>
          )}
        </section>
      )}

      <section className="overflow-x-auto rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="mb-2 font-semibold">Orders</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-stone-500">No orders yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Order</th>
                <th className="py-2 pr-3 font-medium">Supplier</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Expected</th>
                <th className="py-2 pr-3 text-right font-medium">Estimated</th>
                <th className="py-2 text-right font-medium">Paid so far</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="py-2 pr-3">
                    <Link href={`/stock/orders/${o.id}`} className="font-medium underline">
                      #{o.number}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{o.supplier.name}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                    {o.status === "ORDERED" && o.state === "PART" && <span className="ml-1 text-xs text-stone-500">part arrived</span>}
                  </td>
                  <td className="py-2 pr-3">{o.expectedOn ?? "-"}</td>
                  <td className="py-2 pr-3 text-right">{formatNpr(o.estimatedTotal)}</td>
                  <td className="py-2 text-right">{formatNpr(o.paidTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {manage && (
        <details open={prefill || undefined} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <summary className="cursor-pointer font-semibold">New purchase order</summary>
          {suppliers.length === 0 || items.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">Add a supplier below and some stock items first.</p>
          ) : (
            <form action={createOrderAction} className="mt-3 space-y-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="font-medium">
                  Supplier
                  <select name="supplierId" required className={input}>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="font-medium">
                  Needed by (optional)
                  <input name="expectedOn" type="date" className={input} />
                </label>
                <label className="font-medium">
                  Note (optional)
                  <input name="note" maxLength={300} className={input} />
                </label>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <label htmlFor={`qty_${i.id}`} className="min-w-0 flex-1 truncate">
                      {i.name} <span className="text-stone-500">({i.unit}, have {i.quantity.toLocaleString("en-GB")})</span>
                    </label>
                    <input
                      id={`qty_${i.id}`}
                      name={`qty_${i.id}`}
                      type="number"
                      min={0}
                      defaultValue={prefill ? (suggested.get(i.id) ?? 0) : 0}
                      className="w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-right"
                    />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-stone-500">Amounts are in grams, millilitres or pieces. Leave 0 for items you are not ordering.</p>
              <div className="flex flex-wrap items-center gap-2">
                <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Save as draft</button>
                {suggestions.length > 0 && !prefill && (
                  <Link href="/stock/orders?fill=low" className="min-h-11 rounded-lg border border-stone-300 px-4 py-2.5">
                    Fill in what is low
                  </Link>
                )}
              </div>
            </form>
          )}
        </details>
      )}

      <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="mb-2 font-semibold">Suppliers</h2>
        {suppliers.length === 0 ? (
          <p className="text-sm text-stone-500">No suppliers yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {suppliers.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium">{s.name}</span>
                <span className="text-stone-500">{s.phone ?? "no phone"}</span>
                {s.notes && <span className="text-stone-500">{s.notes}</span>}
                {manage && (
                  <form action={archiveSupplierAction.bind(null, s.id)} className="ml-auto">
                    <button className="text-xs text-red-700 underline">Remove</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {manage && (
          <form action={createSupplierAction} className="mt-3 grid gap-2 border-t border-stone-100 pt-3 text-sm sm:grid-cols-4">
            <label className="font-medium">
              Name
              <input name="name" required maxLength={80} className={input} />
            </label>
            <label className="font-medium">
              Phone (optional)
              <input name="phone" type="tel" placeholder="98XXXXXXXX" className={input} />
            </label>
            <label className="font-medium">
              PAN (optional)
              <input name="panNumber" inputMode="numeric" maxLength={9} className={input} />
            </label>
            <label className="font-medium">
              Notes (optional)
              <input name="notes" maxLength={300} className={input} />
            </label>
            <div className="flex items-end">
              <button className="min-h-11 rounded-lg border border-stone-300 px-4 font-medium">Add supplier</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
