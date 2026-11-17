import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { formatNpr } from "@/features/billing/calc";
import { localDate } from "@/lib/business-day";
import { formatHours, isPeriod } from "@/features/payroll/payroll";
import { listAdjustments, listPayTerms, listRuns, previewPayroll } from "@/features/payroll/server/payroll";
import { addAdjustmentAction, finalizeAction, markPaidAction, removeAdjustmentAction, setTermsAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "min-h-9 px-2 text-sm";
const small = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";
const KIND = { ALLOWANCE: "Allowance (adds)", BONUS: "Bonus (adds)", ADVANCE: "Advance already given (takes off)", DEDUCTION: "Deduction (takes off)" } as const;

export default async function PayrollPage({ searchParams }: PageProps<"/payroll">) {
  const ctx = await requireTenant("payroll.manage");
  const q = await searchParams;
  const business = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const thisMonth = localDate(new Date(), business.timezone).slice(0, 7);
  const period = typeof q.period === "string" && isPeriod(q.period) ? q.period : thisMonth;
  const error = typeof q.error === "string" ? q.error : null;

  const [terms, preview, adjustments, runs] = await Promise.all([listPayTerms(ctx), previewPayroll(ctx, period), listAdjustments(ctx, period), listRuns(ctx)]);
  const nameOf = new Map(terms.map((t) => [t.userId, t.name]));
  const run = runs.find((r) => r.periodStart === preview.start && r.periodEnd === preview.end);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Payroll</h1>
          <p className="text-sm text-stone-500">
            Hours come from the Time page. Amounts are before any tax or statutory deductions, which this app does not work out.
          </p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <label className="text-sm font-medium">
            Month
            <input name="period" type="month" defaultValue={period} className={`mt-1 block ${field}`} />
          </label>
          <button className={small}>Show</button>
        </form>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="card overflow-x-auto p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{preview.finalized ? "Finalized payroll" : "Payroll so far"} for {period}</h2>
          {preview.finalized && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">locked</span>}
        </div>
        {preview.lines.length === 0 ? (
          <p className="text-sm text-stone-500">Nobody has pay terms yet. Set them below.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Person</th>
                <th className="py-2 pr-3 text-right font-medium">Hours</th>
                <th className="py-2 pr-3 text-right font-medium">Overtime</th>
                <th className="py-2 pr-3 text-right font-medium">Base pay</th>
                <th className="py-2 pr-3 text-right font-medium">Overtime pay</th>
                <th className="py-2 pr-3 text-right font-medium">Adds</th>
                <th className="py-2 pr-3 text-right font-medium">Takes off</th>
                <th className="py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {preview.lines.map((l) => (
                <tr key={l.userId}>
                  <td className="py-2 pr-3 font-medium">
                    {l.name}
                    {l.stillClockedIn && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">still clocked in</span>}
                  </td>
                  <td className="py-2 pr-3 text-right">{formatHours(l.regularMinutes + l.overtimeMinutes)}</td>
                  <td className="py-2 pr-3 text-right">{formatHours(l.overtimeMinutes)}</td>
                  <td className="py-2 pr-3 text-right">{formatNpr(l.basePay)}</td>
                  <td className="py-2 pr-3 text-right">{formatNpr(l.overtimePay)}</td>
                  <td className="py-2 pr-3 text-right">{formatNpr(l.additions)}</td>
                  <td className="py-2 pr-3 text-right">{formatNpr(l.deductions)}</td>
                  <td className={`py-2 text-right font-semibold ${l.netPay < 0 ? "text-red-700" : ""}`}>{formatNpr(l.netPay)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2 pr-3" colSpan={7}>
                  Total
                </td>
                <td className="py-2 text-right">{formatNpr(preview.total)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {preview.lines.some((l) => l.netPay < 0) && <p className="mt-2 text-sm text-red-700">A negative net means advances and deductions are larger than the pay. Check it before finalizing.</p>}
        {!preview.finalized && preview.lines.length > 0 && (
          <form action={finalizeAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="period" value={period} />
            <input name="note" maxLength={200} placeholder="Note (optional)" aria-label="Note" className={`w-56 ${field}`} />
            <button className="btn-primary">Finalize {period}</button>
            <span className="text-xs text-stone-500">Locks the month&rsquo;s hours and adjustments. Needs everyone clocked out.</span>
          </form>
        )}
      </section>

      {run && (
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Payment status</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {run.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {l.name} · <strong>{formatNpr(l.netPay)}</strong>
                </span>
                {l.paidAt ? (
                  <span className="text-emerald-800">Paid {l.paidAt.toLocaleDateString("en-GB")} by {l.paidMethod}</span>
                ) : (
                  <form action={markPaidAction.bind(null, l.id)} className="flex items-center gap-2">
                    <input type="hidden" name="period" value={period} />
                    <input name="method" required defaultValue="Cash" maxLength={40} aria-label="How paid" className={`w-28 ${field}`} />
                    <button className={small}>Mark paid</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!preview.finalized && (
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Adjustments for {period}</h2>
          {adjustments.length > 0 && (
            <ul className="divide-y divide-stone-100 text-sm">
              {adjustments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>
                    {nameOf.get(a.userId) ?? "Staff"} · {KIND[a.kind]} · {formatNpr(a.amount)}
                    {a.note && <span className="text-stone-500"> · {a.note}</span>}
                  </span>
                  <form action={removeAdjustmentAction.bind(null, a.id)}>
                    <input type="hidden" name="period" value={period} />
                    <button className="text-xs text-red-700 underline">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addAdjustmentAction} className="flex flex-wrap items-end gap-2 rounded-xl bg-stone-50 p-3">
            <input type="hidden" name="period" value={period} />
            <select name="userId" required aria-label="Person" className={field}>
              {terms.map((t) => (
                <option key={t.userId} value={t.userId}>
                  {t.name}
                </option>
              ))}
            </select>
            <select name="kind" aria-label="Kind" className={field}>
              {Object.entries(KIND).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input name="amount" type="number" min={0.01} step="0.01" required placeholder="Rs" aria-label="Amount" className={`w-28 ${field}`} />
            <input name="note" maxLength={200} placeholder="Note" aria-label="Note" className={`w-48 ${field}`} />
            <button className={small}>Add</button>
          </form>
        </section>
      )}

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Pay terms</h2>
        <p className="text-xs text-stone-500">Hourly: paid for hours worked, with overtime beyond the daily limit. Monthly: a fixed salary whatever the hours. Not tracked: left out of payroll.</p>
        <ul className="divide-y divide-stone-100">
          {terms.map((t) => (
            <li key={t.userId} className="py-3">
              <form action={setTermsAction.bind(null, t.userId)} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="period" value={period} />
                <span className="w-40 text-sm font-medium">
                  {t.name} <span className="text-xs font-normal text-stone-400">{t.role.toLowerCase()}</span>
                </span>
                <select name="payType" defaultValue={t.payType} aria-label={`Pay type for ${t.name}`} className={field}>
                  <option value="NONE">Not tracked</option>
                  <option value="HOURLY">Hourly</option>
                  <option value="MONTHLY">Monthly salary</option>
                </select>
                <label className="flex items-center gap-1 text-xs text-stone-500">
                  Rs
                  <input name="payRate" type="number" min={0} step="0.01" defaultValue={t.payRate / 100} aria-label={`Pay rate for ${t.name}`} className={`w-28 ${field}`} />
                  <span>per hour or month</span>
                </label>
                <label className="flex items-center gap-1 text-xs text-stone-500">
                  Overtime ×
                  <input name="overtimeTimes" type="number" min={1} max={4} step="0.05" defaultValue={t.overtimeBps / 10_000} className={`w-20 ${field}`} />
                </label>
                <label className="flex items-center gap-1 text-xs text-stone-500">
                  after
                  <input name="overtimeAfterHours" type="number" min={1} max={16} step="0.5" defaultValue={t.overtimeAfterMinutes / 60} className={`w-20 ${field}`} /> h/day
                </label>
                <button className={small}>Save</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
