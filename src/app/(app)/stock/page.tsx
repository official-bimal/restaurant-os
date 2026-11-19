import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { listNotStockedHere, listStock } from "@/features/stock/server/service";
import { db } from "@/server/db";
import { formatNpr } from "@/features/billing/calc";
import { archiveItemAction, countAction, createItemAction, purchaseAction, setStockedAction, updateItemAction, wasteAction } from "./actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const small = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";

const STATUS = {
  OK: { label: "OK", cls: "bg-green-100 text-green-800" },
  LOW: { label: "Low", cls: "bg-amber-100 text-amber-800" },
  OUT: { label: "Out", cls: "bg-red-100 text-red-800" },
  NEGATIVE: { label: "Below zero: count it", cls: "bg-red-100 text-red-800" },
} as const;

/** Cost per kilogram/litre for grams/ml, per piece otherwise, from milli-paisa per unit. */
function costLabel(unit: string, costMilli: number): string {
  if (costMilli === 0) return "no cost yet";
  if (unit === "piece") return `${formatNpr(Math.round(costMilli / 1000))} each`;
  return `${formatNpr(Math.round(costMilli))} per ${unit === "g" ? "kg" : "litre"}`;
}

export default async function StockPage({ searchParams }: PageProps<"/stock">) {
  const ctx = await requireTenant("stock.view");
  const { error } = await searchParams;
  const [items, notHere, branch] = await Promise.all([
    listStock(ctx),
    listNotStockedHere(ctx),
    db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId: ctx.businessId, id: ctx.branchId } }, select: { name: true } }),
  ]);
  const manage = can(ctx.role, "stock.manage");
  const waste = can(ctx.role, "stock.waste");
  const attention = items.filter((i) => i.status !== "OK");

  const itemSelect = (
    <select name="stockItemId" required className={input}>
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name} ({i.unit})
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Stock</h1>
          <p className="text-sm text-stone-500">{branch.name}: quantities, reorder levels and costs are for this branch only.</p>
        </div>
        <Link href="/stock/branches" className={`${small} flex items-center`}>
          All branches and transfers
        </Link>
        {can(ctx.role, "supplier.pay") && (
          <Link href="/stock/bills" className={`${small} flex items-center`}>
            Supplier bills
          </Link>
        )}
        {can(ctx.role, "report.view") && (
          <Link href="/stock/value" className={`${small} flex items-center`}>
            Value and cost
          </Link>
        )}
        <Link href="/stock/orders" className={`${small} flex items-center`}>
          Purchase orders
        </Link>
        {manage && (
          <Link href="/stock/reorder" className={`${small} flex items-center`}>
            What to order
          </Link>
        )}
        {manage && (
          <Link href="/stock/recipes" className={`${small} flex items-center`}>
            Recipes and food cost
          </Link>
        )}
        <Link href="/stock/history" className={`${small} flex items-center`}>
          History
        </Link>
      </div>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {attention.length > 0 && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Needs attention: {attention.map((i) => i.name).join(", ")}.
        </p>
      )}

      <section className="overflow-x-auto rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        {items.length === 0 ? (
          <p className="text-stone-500">No stock items yet. Add flour, milk or anything the kitchen uses up.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="py-2 pr-3 text-right font-medium">On hand</th>
                <th className="py-2 pr-3 text-right font-medium">Reorder at</th>
                <th className="py-2 pr-3 font-medium">Average cost</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {items.map((i) => (
                <tr key={i.id} className="align-top">
                  <td className="py-2 pr-3 font-medium">
                    {i.name}
                    {manage && (
                      <details className="font-normal">
                        <summary className="cursor-pointer text-xs text-stone-500">Edit</summary>
                        <form action={updateItemAction.bind(null, i.id)} className="mt-1 flex flex-wrap items-end gap-2">
                          <input name="name" defaultValue={i.name} required maxLength={80} aria-label="Name" className="rounded-lg border border-stone-300 px-2 py-1.5" />
                          <input name="reorderLevel" type="number" min={0} defaultValue={i.reorderLevel} aria-label="Reorder level" className="w-24 rounded-lg border border-stone-300 px-2 py-1.5" />
                          <button className={small}>Save</button>
                        </form>
                        <form action={setStockedAction.bind(null, i.id, false)} className="mt-1">
                          <button className="text-xs text-stone-600 underline">Not stocked at this branch</button>
                        </form>
                        <form action={archiveItemAction.bind(null, i.id)} className="mt-1">
                          <button className="text-xs text-red-700 underline">Archive in every branch</button>
                        </form>
                      </details>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {i.quantity.toLocaleString("en-GB")} {i.unit}
                  </td>
                  <td className="py-2 pr-3 text-right">{i.reorderLevel > 0 ? `${i.reorderLevel.toLocaleString("en-GB")} ${i.unit}` : "none"}</td>
                  <td className="py-2 pr-3">{costLabel(i.unit, i.costMilli)}</td>
                  <td className="py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-stone-500">Amounts are in grams, millilitres or pieces. 1 kg is 1,000 g; 1 litre is 1,000 ml.</p>
      </section>

      {manage && notHere.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold">Not stocked at {branch.name}</h2>
          <p className="text-sm text-stone-500">These are hidden here (alerts, orders and sales ignore them) and still stocked by other branches.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {notHere.map((i) => (
              <li key={i.id}>
                <form action={setStockedAction.bind(null, i.id, true)}>
                  <button className={small}>Stock {i.name} here</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {manage && (
          <details className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
            <summary className="cursor-pointer font-semibold">Add a stock item</summary>
            <form action={createItemAction} className="mt-3 space-y-2 text-sm">
              <label className="block font-medium">
                Name
                <input name="name" required maxLength={80} className={input} />
              </label>
              <label className="block font-medium">
                Unit
                <select name="unit" className={input}>
                  <option value="g">grams (g)</option>
                  <option value="ml">millilitres (ml)</option>
                  <option value="piece">pieces</option>
                </select>
              </label>
              <label className="block font-medium">
                Warn me when it falls to (optional)
                <input name="reorderLevel" type="number" min={0} defaultValue={0} className={input} />
              </label>
              <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Add</button>
            </form>
          </details>
        )}

        {manage && items.length > 0 && (
          <details className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
            <summary className="cursor-pointer font-semibold">Record a purchase</summary>
            <form action={purchaseAction} className="mt-3 space-y-2 text-sm">
              <label className="block font-medium">
                Item
                {itemSelect}
              </label>
              <label className="block font-medium">
                Quantity received
                <input name="quantity" type="number" min={1} required className={input} />
              </label>
              <label className="block font-medium">
                Total paid (Rs)
                <input name="totalRupees" type="number" min={0} step="0.01" required className={input} />
              </label>
              <label className="block font-medium">
                Supplier (optional)
                <input name="supplier" maxLength={80} className={input} />
              </label>
              <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Add to stock</button>
            </form>
          </details>
        )}

        {waste && items.length > 0 && (
          <details className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
            <summary className="cursor-pointer font-semibold">Record waste or spoilage</summary>
            <form action={wasteAction} className="mt-3 space-y-2 text-sm">
              <label className="block font-medium">
                Item
                {itemSelect}
              </label>
              <label className="block font-medium">
                Quantity thrown away
                <input name="quantity" type="number" min={1} required className={input} />
              </label>
              <label className="block font-medium">
                Reason
                <input name="reason" required minLength={3} maxLength={200} placeholder="e.g. spoiled, dropped" className={input} />
              </label>
              <button className="min-h-11 rounded-lg border border-stone-300 px-4 font-medium">Record waste</button>
            </form>
          </details>
        )}

        {manage && items.length > 0 && (
          <details className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
            <summary className="cursor-pointer font-semibold">Count stock</summary>
            <form action={countAction} className="mt-3 space-y-2 text-sm">
              <label className="block font-medium">
                Item
                {itemSelect}
              </label>
              <label className="block font-medium">
                Amount actually on the shelf
                <input name="counted" type="number" min={0} required className={input} />
              </label>
              <label className="block font-medium">
                Note (optional)
                <input name="note" maxLength={200} className={input} />
              </label>
              <button className="min-h-11 rounded-lg border border-stone-300 px-4 font-medium">Save the count</button>
              <p className="text-xs text-stone-500">The book quantity becomes this number and the difference is recorded.</p>
            </form>
          </details>
        )}
      </div>
    </div>
  );
}
