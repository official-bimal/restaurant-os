import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { formatNpr } from "@/features/billing/calc";
import { COVER_CHOICES, showQty, WINDOW_CHOICES } from "@/features/purchasing/reorder";
import { getReorderPlan, getSupplyList } from "@/features/purchasing/server/reorder";
import { makeDraftAction, setLeadAction, setSupplyAction } from "./actions";

export const dynamic = "force-dynamic";

const sel = "mt-1 block min-h-10 rounded-lg border border-stone-300 px-2 text-sm";
const URGENCY = {
  NOW: { label: "Order now", tone: "bg-red-100 text-red-800" },
  SOON: { label: "Soon", tone: "bg-amber-100 text-amber-900" },
  OK: { label: "", tone: "" },
} as const;

export default async function ReorderPage({ searchParams }: PageProps<"/stock/reorder">) {
  const ctx = await requireTenant("stock.manage");
  const sp = await searchParams;
  const plan = await getReorderPlan(ctx, { windowDays: Number(sp.window) || undefined, coverDays: Number(sp.cover) || undefined });
  const items = await getSupplyList(ctx);
  const hidden = (
    <>
      <input type="hidden" name="windowDays" value={plan.windowDays} />
      <input type="hidden" name="coverDays" value={plan.coverDays} />
    </>
  );
  const supplierName = new Map(plan.suppliers.map((s) => [s.id, s.name]));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/stock" className="text-sm text-stone-500 hover:underline">
          ← Stock
        </Link>
        <h1 className="text-xl font-semibold">What to order</h1>
      </div>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}
      <p className="text-sm text-stone-600">
        Worked out from how fast each ingredient is really used (sales and waste), the supplier&apos;s lead time and the days of stock you want in hand when the order arrives. Stock already on order is counted.
        It is a suggestion: you look it over as a draft order before anything is sent.
      </p>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm">
          Look at the last
          <select name="window" defaultValue={plan.windowDays} className={sel}>
            {WINDOW_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Keep in hand
          <select name="cover" defaultValue={plan.coverDays} className={sel}>
            {COVER_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} days of stock
              </option>
            ))}
          </select>
        </label>
        <button className="min-h-10 rounded-lg bg-teal-700 px-4 text-sm font-medium text-white">Show</button>
      </form>
      <p className="text-xs text-stone-500">Use is averaged over {plan.dataDays} day{plan.dataDays === 1 ? "" : "s"} of sales records.{plan.dataDays < plan.windowDays ? " There is not a full window of history yet, so the rates are rough." : ""}</p>

      {plan.groups.length === 0 && <p className="card p-4 text-stone-600">Nothing needs ordering right now.</p>}
      {plan.groups.map((g) => (
        <section key={g.supplier?.id ?? "none"} className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">
              {g.supplier ? g.supplier.name : "No usual supplier chosen"}{" "}
              {g.supplier && <span className="text-sm font-normal text-stone-600">(delivers in {g.supplier.leadDays} day{g.supplier.leadDays === 1 ? "" : "s"})</span>}
            </h2>
            {g.urgent > 0 && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">{g.urgent} to order now</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-stone-600">
                  <th className="py-1">Item</th>
                  <th className="py-1 text-right">In stock</th>
                  <th className="py-1 text-right">On order</th>
                  <th className="py-1 text-right">Used a day</th>
                  <th className="py-1 text-right">Lasts</th>
                  <th className="py-1 text-right">Order</th>
                  <th className="py-1 text-right">About</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l) => (
                  <tr key={l.stockItemId} className="border-t border-stone-100">
                    <td className="py-1">{l.name}</td>
                    <td className="py-1 text-right">{showQty(Math.max(0, l.onHand), l.unit)}</td>
                    <td className="py-1 text-right">{l.onOrder ? showQty(l.onOrder, l.unit) : "-"}</td>
                    <td className="py-1 text-right">{l.dailyUse > 0 ? showQty(Math.round(l.dailyUse), l.unit) : "-"}</td>
                    <td className="py-1 text-right">{l.daysLeft === null ? "-" : `${l.daysLeft} d`}</td>
                    <td className="py-1 text-right font-semibold">{showQty(l.quantity, l.unit)}</td>
                    <td className="py-1 text-right">{l.estimatedTotal ? formatNpr(l.estimatedTotal) : "no price yet"}</td>
                    <td className="py-1 text-right">{URGENCY[l.urgency].label && <span className={`rounded px-2 py-0.5 text-xs ${URGENCY[l.urgency].tone}`}>{URGENCY[l.urgency].label}</span>}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-stone-300 font-semibold">
                  <td className="py-1" colSpan={6}>
                    About
                  </td>
                  <td className="py-1 text-right">{formatNpr(g.total)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <form action={makeDraftAction.bind(null, g.supplier?.id ?? "none")} className="flex flex-wrap items-end gap-2">
            {hidden}
            {!g.supplier && (
              <label className="text-sm">
                Order these from
                <select name="chooseSupplierId" required defaultValue="" className={sel}>
                  <option value="">Choose a supplier…</option>
                  {plan.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="min-h-10 rounded-lg bg-teal-700 px-4 text-sm font-medium text-white">Make a draft order</button>
          </form>
        </section>
      ))}

      <details className="card p-4">
        <summary className="cursor-pointer font-semibold">Set up suppliers and pack sizes</summary>
        <p className="mt-2 text-sm text-stone-600">
          Say who each item is usually bought from, and how many come in a pack (for example 1000 g in a 1 kg bag, or 24 pieces in a crate), so suggestions are whole packs and go to the right supplier.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {plan.suppliers.map((s) => (
            <form key={s.id} action={setLeadAction.bind(null, s.id)} className="flex items-end gap-2 rounded-lg bg-stone-50 p-2 text-sm">
              {hidden}
              <span className="min-w-0 flex-1 font-medium">{s.name}</span>
              <label className="text-xs">
                Delivers in (days)
                <input name="leadDays" type="number" min={0} max={60} defaultValue={s.leadDays} className="mt-1 block w-20 rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
              </label>
              <button className="min-h-9 rounded-lg border border-stone-300 px-3">Save</button>
            </form>
          ))}
        </div>
        <div className="mt-3 divide-y divide-stone-100">
          {items.map((i) => (
            <form key={i.id} action={setSupplyAction.bind(null, i.id)} className="flex flex-wrap items-end gap-2 py-2 text-sm">
              {hidden}
              <span className="min-w-[8rem] flex-1">
                {i.name} <span className="text-xs text-stone-500">({i.unit})</span>
              </span>
              <label className="text-xs">
                Usual supplier
                <select name="supplierId" defaultValue={i.supplierId ?? ""} className={sel}>
                  <option value="">None</option>
                  {plan.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                One pack is ({i.unit})
                <input name="packQuantity" type="number" min={1} defaultValue={i.packQuantity} className="mt-1 block w-24 rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
              </label>
              <button className="min-h-9 rounded-lg border border-stone-300 px-3">Save</button>
              {i.supplierId && !supplierName.has(i.supplierId) && <span className="text-xs text-amber-800">(supplier no longer active)</span>}
            </form>
          ))}
        </div>
      </details>
    </div>
  );
}
