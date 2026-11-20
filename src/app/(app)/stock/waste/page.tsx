import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { listStock } from "@/features/stock/server/service";
import { wasteReport } from "@/features/stock/server/counts";
import { WASTE_REASONS, wasteReasonLabel } from "@/features/stock/count";
import { formatNpr } from "@/features/billing/calc";
import { wasteAction } from "../actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

export default async function WastePage({ searchParams }: PageProps<"/stock/waste">) {
  const ctx = await requireTenant("stock.view");
  const q = await searchParams;
  const canRecord = can(ctx, "stock.waste");
  const canSee = can(ctx, "stock.manage") || can(ctx, "report.view");
  const items = canRecord ? await listStock(ctx) : [];

  let report = null;
  let error = typeof q.error === "string" ? q.error : null;
  if (canSee) {
    try {
      report = await wasteReport(ctx, { from: typeof q.from === "string" ? q.from : undefined, to: typeof q.to === "string" ? q.to : undefined });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      error = e.message;
      report = await wasteReport(ctx);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/stock" className="text-sm text-stone-500 hover:underline">
          ← Stock
        </Link>
        <h1 className="text-xl font-semibold">Waste</h1>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {canRecord && items.length > 0 && (
        <form action={wasteAction} className="card space-y-3 p-4">
          <input type="hidden" name="back" value="waste" />
          <h2 className="font-semibold">Record something thrown away</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm font-medium sm:col-span-2">
              Item
              <select name="stockItemId" required className={input}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.unit})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Amount
              <input name="quantity" type="number" min={1} required className={input} />
            </label>
            <label className="text-sm font-medium">
              Why
              <select name="category" required defaultValue="SPOILED" className={input}>
                {WASTE_REASONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium sm:col-span-4">
              Details (optional)
              <input name="reason" maxLength={200} placeholder="e.g. fridge was left open" className={input} />
            </label>
          </div>
          <button className="min-h-11 rounded-lg border border-stone-300 px-4 font-medium">Record waste</button>
        </form>
      )}

      {report && (
        <>
          <form method="get" className="card flex flex-wrap items-end gap-3 p-4">
            <label className="text-sm font-medium">
              From
              <input type="date" name="from" defaultValue={report.from} className="mt-1 block min-h-10 rounded-lg border border-stone-300 px-3 text-sm" />
            </label>
            <label className="text-sm font-medium">
              To
              <input type="date" name="to" defaultValue={report.to} className="mt-1 block min-h-10 rounded-lg border border-stone-300 px-3 text-sm" />
            </label>
            <button className="min-h-10 rounded-lg border border-stone-300 px-4 text-sm font-medium">Show</button>
          </form>

          <div className="rounded-2xl bg-amber-50 p-4 text-amber-950">
            <p className="text-xs font-medium opacity-80">
              Thrown away, {report.from} to {report.to}
            </p>
            <p className="mt-1 text-2xl font-semibold">{formatNpr(report.total)}</p>
            <p className="text-xs opacity-70">
              {report.entries} record{report.entries === 1 ? "" : "s"}, at the average cost of each item.
            </p>
          </div>

          {report.entries === 0 ? (
            <p className="card p-4 text-stone-600">Nothing was thrown away in this period.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="card space-y-2 p-4">
                <h2 className="font-semibold">By cause</h2>
                <ul className="divide-y divide-stone-100 text-sm">
                  {report.byReason.map((r) => (
                    <li key={r.reason} className="flex justify-between py-2">
                      <span>
                        {r.label} <span className="text-stone-500">({r.entries})</span>
                      </span>
                      <span className="tabular-nums">{formatNpr(r.cost)}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="card space-y-2 p-4">
                <h2 className="font-semibold">By item</h2>
                <ul className="divide-y divide-stone-100 text-sm">
                  {report.byItem.slice(0, 15).map((i) => (
                    <li key={i.stockItemId} className="flex justify-between gap-3 py-2">
                      <span>
                        {i.name} <span className="text-stone-500">{i.quantity.toLocaleString("en-GB")} {i.unit}</span>
                      </span>
                      <span className="tabular-nums">{formatNpr(i.cost)}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="card space-y-2 p-4 md:col-span-2">
                <h2 className="font-semibold">Latest records</h2>
                <ul className="divide-y divide-stone-100 text-sm">
                  {report.recent.map((m) => (
                    <li key={m.id} className="flex flex-wrap justify-between gap-x-4 py-2">
                      <span>
                        {m.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {m.stockItem.name} · {(-m.quantity).toLocaleString("en-GB")} {m.stockItem.unit} · {wasteReasonLabel(m.reason)}
                        {m.note && m.note !== wasteReasonLabel(m.reason) ? ` · ${m.note}` : ""}
                      </span>
                      <span className="tabular-nums">{formatNpr(-m.totalCost)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
