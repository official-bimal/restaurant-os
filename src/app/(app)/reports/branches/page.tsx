import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { formatNpr } from "@/features/billing/calc";
import { getBranchRollup } from "@/features/reports/server/service";
import { DomainError } from "@/server/errors";

export const dynamic = "force-dynamic";

const field = "min-h-10 px-3 text-sm";
const TYPE = { DINE_IN: "Dine in", TAKEAWAY: "Takeaway", QUICK_BILL: "Quick bill", DELIVERY: "Delivery" } as Record<string, string>;

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: string }) {
  return (
    <div className={`rounded-2xl p-4 ${tone}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs opacity-70">{hint}</p>}
    </div>
  );
}

export default async function BranchRollupPage({ searchParams }: PageProps<"/reports/branches">) {
  const ctx = await requireTenant("report.view");
  const q = await searchParams;
  const from = typeof q.from === "string" ? q.from : undefined;
  const to = typeof q.to === "string" ? q.to : undefined;
  let rollup;
  let error: string | null = null;
  try {
    rollup = await getBranchRollup(ctx, { from, to });
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    error = e.message;
    rollup = await getBranchRollup(ctx);
  }
  const c = rollup.combined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Sales across branches</h1>
          <p className="text-sm text-stone-500">All branches you work in. Each branch is worked out as its own daily report is; the total is their sum.</p>
        </div>
        <Link href="/reports" className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm leading-9 hover:bg-stone-50">
          Daily report
        </Link>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <form method="get" className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm font-medium">
          From
          <input name="from" type="date" defaultValue={rollup.from} className={`mt-1 block ${field}`} />
        </label>
        <label className="text-sm font-medium">
          To
          <input name="to" type="date" defaultValue={rollup.to} className={`mt-1 block ${field}`} />
        </label>
        <button className="btn-primary">Show</button>
      </form>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Net sales" value={formatNpr(c.net)} hint="After refunds" tone="bg-emerald-50 text-emerald-900" />
        <Stat label="Bills paid" value={String(c.sales.count)} hint={c.refunds.count ? `${c.refunds.count} refunded` : "No refunds"} tone="bg-blue-50 text-blue-900" />
        <Stat label="Average bill" value={c.sales.count ? formatNpr(c.sales.average) : "—"} tone="bg-violet-50 text-violet-900" />
        <Stat label="VAT collected" value={formatNpr(c.netVat)} hint="After refunds" tone="bg-amber-50 text-amber-900" />
      </section>

      <section className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-semibold">By branch</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-stone-500">
            <tr>
              <th className="py-2 pr-3 font-medium">Branch</th>
              <th className="py-2 pr-3 text-right font-medium">Bills</th>
              <th className="py-2 pr-3 text-right font-medium">Average</th>
              <th className="py-2 pr-3 text-right font-medium">Gross</th>
              <th className="py-2 pr-3 text-right font-medium">Refunds</th>
              <th className="py-2 pr-3 text-right font-medium">Net</th>
              <th className="py-2 pr-3 text-right font-medium">Cash</th>
              <th className="py-2 pr-3 text-right font-medium">QR</th>
              <th className="py-2 pr-3 text-right font-medium">Card</th>
              <th className="py-2 pr-3 text-right font-medium">Credit</th>
              <th className="py-2 text-right font-medium">Food cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rollup.branches.map((b) => (
              <tr key={b.id}>
                <td className="py-2 pr-3 font-medium">
                  {b.name}
                  {!b.active && <span className="ml-1 text-xs text-stone-400">(switched off)</span>}
                </td>
                <td className="py-2 pr-3 text-right">{b.report.sales.count}</td>
                <td className="py-2 pr-3 text-right">{b.report.sales.count ? formatNpr(b.report.sales.average) : "—"}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.report.sales.gross)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.report.refunds.total)}</td>
                <td className="py-2 pr-3 text-right font-medium">{formatNpr(b.report.net)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.report.byMethod.CASH.net)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.report.byMethod.QR.net)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.report.byMethod.CARD.net)}</td>
                <td className="py-2 pr-3 text-right">{formatNpr(b.report.byMethod.CREDIT.net)}</td>
                <td className="py-2 text-right">{formatNpr(b.report.foodCost)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2 pr-3">All branches</td>
              <td className="py-2 pr-3 text-right">{c.sales.count}</td>
              <td className="py-2 pr-3 text-right">{c.sales.count ? formatNpr(c.sales.average) : "—"}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(c.sales.gross)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(c.refunds.total)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(c.net)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(c.byMethod.CASH.net)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(c.byMethod.QR.net)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(c.byMethod.CARD.net)}</td>
              <td className="py-2 pr-3 text-right">{formatNpr(c.byMethod.CREDIT.net)}</td>
              <td className="py-2 text-right">{formatNpr(c.foodCost)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Best sellers, all branches</h2>
          {c.topItems.length === 0 ? (
            <p className="text-sm text-stone-500">No sales in this period.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {c.topItems.map((i) => (
                <li key={i.name} className="flex justify-between py-1.5">
                  <span>
                    {i.name} <span className="text-stone-500">× {i.quantity}</span>
                  </span>
                  <span>{formatNpr(i.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">By order type</h2>
          {c.byType.length === 0 ? (
            <p className="text-sm text-stone-500">No sales in this period.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {c.byType.map((t) => (
                <li key={t.type} className="flex justify-between py-1.5">
                  <span>
                    {TYPE[t.type] ?? t.type} <span className="text-stone-500">× {t.count}</span>
                  </span>
                  <span>{formatNpr(t.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
