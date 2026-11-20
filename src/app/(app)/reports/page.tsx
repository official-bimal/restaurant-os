import Link from "next/link";
import { db } from "@/server/db";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { getDayReport } from "@/features/reports/server/service";
import { formatNpr } from "@/features/billing/calc";
import { addDays, isValidDate } from "@/lib/business-day";
import { closeDayAction, reopenDayAction } from "./actions";

export const dynamic = "force-dynamic";

const TYPE = { DINE_IN: "Dine in", TAKEAWAY: "Takeaway", QUICK_BILL: "Quick bill", DELIVERY: "Delivery" } as Record<string, string>;
const METHOD = { CASH: "Cash", QR: "QR", CARD: "Card", CREDIT: "Credit" } as const;
const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

function label(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const ctx = await requireTenant("report.view");
  const { date: rawDate, error } = await searchParams;
  const requested = typeof rawDate === "string" && isValidDate(rawDate) ? rawDate : undefined;

  let data;
  try {
    data = await getDayReport(ctx, requested);
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw e;
  }
  const { date, today, report, dayClose, closedByName, openOrders } = data;
  const isFuture = date > today;
  const canClose = can(ctx, "day.close") && !dayClose && !isFuture;
  const multiBranch = (await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { multiBranch: true } })).multiBranch;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{label(date)}</h1>
        {multiBranch && (
          <Link href="/reports/branches" className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 text-sm">
            All branches
          </Link>
        )}
        <Link href={`/reports?date=${addDays(date, -1)}`} className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 text-sm">
          ← Previous
        </Link>
        {date !== today && (
          <Link href="/reports" className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 text-sm">
            Today
          </Link>
        )}
        {date < today && (
          <Link href={`/reports?date=${addDays(date, 1)}`} className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 text-sm">
            Next →
          </Link>
        )}
        <form method="get" className="flex items-center gap-1">
          <input type="date" name="date" defaultValue={date} max={today} aria-label="Choose a date" className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm">Go</button>
        </form>
      </div>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Net sales", formatNpr(report.net)],
          ["Gross sales", formatNpr(report.sales.gross)],
          ["Refunds", formatNpr(report.refunds.total)],
          ["Bills", String(report.sales.count)],
          ["Average bill", formatNpr(report.sales.average)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-white p-3 border border-stone-200 shadow-sm">
            <dt className="text-xs text-stone-500">{k}</dt>
            <dd className="text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <h2 className="mb-2 font-semibold">How it was paid</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="py-1 font-medium">Method</th>
                <th className="py-1 text-right font-medium">Taken</th>
                <th className="py-1 text-right font-medium">Refunded</th>
                <th className="py-1 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {(Object.keys(METHOD) as (keyof typeof METHOD)[])
                .filter((m) => report.byMethod[m].sales || report.byMethod[m].refunds || m === "CASH")
                .map((m) => (
                  <tr key={m}>
                    <td className="py-1">{METHOD[m]}</td>
                    <td className="py-1 text-right">{formatNpr(report.byMethod[m].sales)}</td>
                    <td className="py-1 text-right">{formatNpr(report.byMethod[m].refunds)}</td>
                    <td className="py-1 text-right font-medium">{formatNpr(report.byMethod[m].net)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <h2 className="mb-2 font-semibold">Charges and tax</h2>
          <dl className="space-y-1 text-sm">
            {[
              ["Items before discounts", report.sales.subtotal],
              ["Discounts", -report.sales.discount],
              ["Reward discounts", -report.sales.loyaltyDiscount],
              ["Service charge", report.sales.serviceCharge],
              ["VAT collected", report.sales.vat],
              ["Delivery fees", report.sales.deliveryFee ?? 0],
              ["Rounding", report.sales.roundOff],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between">
                <dt className="text-stone-600">{k}</dt>
                <dd>{formatNpr(v as number)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-stone-200 pt-1">
              <dt className="text-stone-600">VAT refunded</dt>
              <dd>{formatNpr(-report.refunds.vat)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Net VAT for the day</dt>
              <dd>{formatNpr(report.netVat)}</dd>
            </div>
          </dl>
        </section>

        {report.foodCost > 0 && (
          <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
            <h2 className="mb-2 font-semibold">Food cost</h2>
            <p className="text-2xl font-semibold">{formatNpr(report.foodCost)}</p>
            <p className="text-sm text-stone-600">
              Ingredients used by the day&apos;s sales, from your recipes
              {report.foodCostPercent !== null ? `: ${report.foodCostPercent}% of the sales price of those dishes.` : "."}
            </p>
            <p className="mt-1 text-xs text-stone-500">Only dishes with a recipe are counted.</p>
          </section>
        )}

        <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <h2 className="mb-2 font-semibold">Top items</h2>
          {report.topItems.length === 0 ? (
            <p className="text-sm text-stone-500">Nothing sold.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {report.topItems.map((i) => (
                <li key={i.name} className="flex justify-between py-1">
                  <span>
                    {i.name} <span className="text-stone-500">× {i.quantity}</span>
                  </span>
                  <span>{formatNpr(i.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <h2 className="mb-2 font-semibold">By order type</h2>
          {report.byType.length === 0 ? (
            <p className="text-sm text-stone-500">No bills.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {report.byType.map((t) => (
                <li key={t.type} className="flex justify-between py-1">
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

      {(report.refundList.length > 0 || report.cancelled.count > 0) && (
        <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <h2 className="mb-2 font-semibold">Refunds and cancellations</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {report.refundList.map((r) => (
              <li key={`r${r.number}`} className="flex justify-between gap-3 py-1">
                <span>
                  Credit note #{r.number} for invoice #{r.invoiceNumber}: {r.reason}
                </span>
                <span className="text-red-700">{formatNpr(-r.total)}</span>
              </li>
            ))}
            {report.cancelled.orders.map((o) => (
              <li key={`c${o.number}`} className="flex justify-between gap-3 py-1">
                <span>
                  Order #{o.number} cancelled ({o.itemCount} item{o.itemCount === 1 ? "" : "s"}): {o.reason ?? "no reason recorded"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="font-semibold">Close the day</h2>
        {dayClose ? (
          <div className="mt-2 space-y-2 text-sm">
            <p className="rounded-lg bg-green-50 p-3 text-green-900">
              Closed {dayClose.closedAt.toLocaleString("en-GB", { timeZone: data.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {closedByName ? ` by ${closedByName}` : ""}. No more payments are taken for this day.
            </p>
            <dl className="grid max-w-md grid-cols-2 gap-1">
              <dt className="text-stone-600">Cash expected</dt>
              <dd className="text-right">{formatNpr(dayClose.expectedCash)}</dd>
              <dt className="text-stone-600">Cash counted</dt>
              <dd className="text-right">{formatNpr(dayClose.countedCash)}</dd>
              <dt className="font-medium">Difference</dt>
              <dd className={`text-right font-medium ${dayClose.difference === 0 ? "" : dayClose.difference < 0 ? "text-red-700" : "text-amber-700"}`}>
                {dayClose.difference === 0 ? "None" : `${dayClose.difference < 0 ? "Short " : "Over "}${formatNpr(Math.abs(dayClose.difference))}`}
              </dd>
            </dl>
            {dayClose.note && <p className="text-stone-600">Note: {dayClose.note}</p>}
            {can(ctx, "day.reopen") && (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-red-700">Reopen this day</summary>
                <form action={reopenDayAction.bind(null, date)} className="mt-2 rounded-lg bg-red-50 p-3 text-sm">
                  <p>The count is removed (it stays in the audit log) and payments can be taken for this day again.</p>
                  <button className="mt-2 min-h-9 rounded-lg bg-red-700 px-3 text-white">Reopen</button>
                </form>
              </details>
            )}
          </div>
        ) : canClose ? (
          <form action={closeDayAction.bind(null, date)} className="mt-2 max-w-md space-y-3 text-sm">
            <p className="text-stone-600">
              Cash that should be in the drawer: <strong>{formatNpr(report.expectedCash)}</strong> (cash taken minus cash refunded).
              Count the drawer and enter what is there.
            </p>
            {openOrders > 0 && (
              <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
                {openOrders} bill{openOrders === 1 ? " is" : "s are"} still open. Pay or cancel {openOrders === 1 ? "it" : "them"} before closing.
              </p>
            )}
            <label className="block font-medium">
              Cash counted (Rs)
              <input name="counted" type="number" min={0} step="0.01" required className={input} />
            </label>
            <label className="block font-medium">
              Note (optional)
              <input name="note" maxLength={300} className={input} />
            </label>
            <button disabled={openOrders > 0} className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white disabled:opacity-50">
              Close the day
            </button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-stone-500">{isFuture ? "This day has not happened yet." : "This day is not closed."}</p>
        )}
      </section>
    </div>
  );
}
