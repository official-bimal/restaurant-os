import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { formatNpr } from "@/features/billing/calc";
import { getStockValueReport } from "@/features/stock/server/report";
import { DomainError } from "@/server/errors";
import { can } from "@/server/permissions";
import { postStockValueAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "min-h-10 px-3 text-sm";

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: string }) {
  return (
    <div className={`rounded-2xl p-4 ${tone}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs opacity-70">{hint}</p>}
    </div>
  );
}

export default async function StockValuePage({ searchParams }: PageProps<"/stock/value">) {
  const ctx = await requireTenant("report.view");
  const q = await searchParams;
  const from = typeof q.from === "string" ? q.from : undefined;
  const to = typeof q.to === "string" ? q.to : undefined;

  let report;
  let error: string | null = null;
  try {
    report = await getStockValueReport(ctx, { from, to });
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    error = e.message;
    report = await getStockValueReport(ctx);
  }
  const t = report.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Stock value and cost</h1>
          <p className="text-sm text-stone-500">
            All branches you work in. Stock is valued at each branch&rsquo;s average cost; anything below zero counts as nothing.
          </p>
        </div>
        <Link href="/stock" className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm leading-9 hover:bg-stone-50">
          Back to stock
        </Link>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <form className="card flex flex-wrap items-end gap-3 p-4" method="get">
        <label className="text-sm font-medium">
          From
          <input name="from" type="date" defaultValue={report.from} className={`mt-1 block ${field}`} />
        </label>
        <label className="text-sm font-medium">
          To
          <input name="to" type="date" defaultValue={report.to} className={`mt-1 block ${field}`} />
        </label>
        <button className="btn-primary">Show</button>
        <p className="text-xs text-stone-500">The period applies to the cost columns. Stock value is as it stands now.</p>
      </form>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Stock on the shelves" value={formatNpr(t.value)} hint="Now, at average cost" tone="bg-emerald-50 text-emerald-900" />
        <Stat label="On its way between branches" value={formatNpr(t.onTheWayValue)} hint="Not counted in anyone's stock yet" tone="bg-sky-50 text-sky-900" />
        <Stat label="Used by sales" value={formatNpr(t.costs.usedBySales)} hint="Cost of ingredients sold" tone="bg-violet-50 text-violet-900" />
        <Stat label="Wasted" value={formatNpr(t.costs.waste)} hint={t.costs.lostInTransit ? `plus ${formatNpr(t.costs.lostInTransit)} lost in transit` : "Spoiled or thrown away"} tone="bg-rose-50 text-rose-900" />
      </section>

      <section className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-semibold">By branch</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-stone-500">
            <tr>
              <th className="py-2 pr-3 font-medium">Branch</th>
              <th className="py-2 pr-3 text-right font-medium">Stock value</th>
              <th className="py-2 pr-3 text-right font-medium">On its way in</th>
              <th className="py-2 pr-3 text-right font-medium">Bought</th>
              <th className="py-2 pr-3 text-right font-medium">Used by sales</th>
              <th className="py-2 pr-3 text-right font-medium">Waste</th>
              <th className="py-2 pr-3 text-right font-medium">Count changes</th>
              <th className="py-2 pr-3 text-right font-medium">Sent out</th>
              <th className="py-2 pr-3 text-right font-medium">Received</th>
              <th className="py-2 text-right font-medium">Lost in transit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {report.branches.map((b) => (
              <tr key={b.id}>
                <td className="py-2 pr-3 font-medium">
                  {b.name}
                  {!b.active && <span className="ml-1 text-xs text-stone-400">(switched off)</span>}
                  {b.belowZeroItems > 0 && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">{b.belowZeroItems} below zero</span>}
                </td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.value)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.onTheWayValue)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.costs.purchases)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.costs.usedBySales)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.costs.waste)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.costs.countAdjustments)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.costs.sentOut)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.costs.receivedIn)}</td>
                <td className="py-2 text-right">{formatNpr(b.costs.lostInTransit)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2 pr-3">All branches</td>
              <td className="py-2 pr-3 text-right">{formatNpr(t.value)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(t.onTheWayValue)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(t.costs.purchases)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(t.costs.usedBySales)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(t.costs.waste)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(t.costs.countAdjustments)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(t.costs.sentOut)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(t.costs.receivedIn)}</td>
              <td className="py-2 text-right">{formatNpr(t.costs.lostInTransit)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-stone-500">
          Between branches, &ldquo;sent out&rdquo; and &ldquo;received&rdquo; cancel each other out in the all-branches row except for stock still on its way or
          lost. Count changes are positive when stock was found and negative when it was missing.
        </p>
      </section>

      <section className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-semibold">By item</h2>
        {report.rows.length === 0 ? (
          <p className="text-sm text-stone-500">No stock items yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Item</th>
                {report.branches.map((b) => (
                  <th key={b.id} className="py-2 pr-3 text-right font-medium">
                    {b.name}
                  </th>
                ))}
                <th className="py-2 pr-3 text-right font-medium">Total quantity</th>
                <th className="py-2 pr-3 text-right font-medium">Total value</th>
                <th className="py-2 text-right font-medium">Average cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {report.rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3">
                    {r.name} <span className="text-xs text-stone-400">{r.unit}</span>
                    {r.belowZero && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">count it</span>}
                  </td>
                  {r.perBranch.map((p) => (
                    <td key={p.branchId} className="py-2 pr-3 text-right">
                      {p.stocked ? (
                        <>
                          {formatNpr(p.value)}
                          <span className="block text-xs text-stone-400">{p.quantity.toLocaleString("en-GB")}</span>
                        </>
                      ) : (
                        <span className="text-xs text-stone-400">not stocked</span>
                      )}
                    </td>
                  ))}
                  <td className="py-2 pr-3 text-right">{r.totalQuantity.toLocaleString("en-GB")}</td>
                  <td className="py-2 pr-3 text-right font-medium">{formatNpr(r.totalValue)}</td>
                  <td className="py-2 text-right text-stone-600">
                    {r.avgCostMilli === 0 ? "—" : r.unit === "piece" ? `${formatNpr(Math.round(r.avgCostMilli / 1000))} each` : `${formatNpr(r.avgCostMilli)} per ${r.unit === "g" ? "kg" : "litre"}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {can(ctx.role, "books.manage") && (
        <section className="card p-4">
          <h2 className="font-semibold">Update the books</h2>
          <p className="mt-1 text-sm text-stone-600">
            Supplier bills reach the books as purchases when they arrive. At the end of each month, bring the books&apos; stock figure in line with what the shelves are worth now (above), so the profit
            and loss shows what was <em>used</em> and not just what was bought. Only the difference is posted, so pressing it twice does nothing the second time.
          </p>
          {typeof q.posted === "string" && (
            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {q.posted === "0" ? "The books already agree with the stock value." : `Posted a stock adjustment of ${formatNpr(Number(q.posted))}.`}
            </p>
          )}
          <form action={postStockValueAction} className="mt-2">
            <button className="min-h-10 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">Post stock value to the books</button>
          </form>
        </section>
      )}
    </div>
  );
}
