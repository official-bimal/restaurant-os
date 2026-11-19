import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { fiscalYearOf, fiscalYearRange } from "@/features/accounting/fiscal";
import { currentPeriod } from "@/features/accounting/server/service";
import { listClosedYears } from "@/features/accounting/server/extras";
import { closeYearAction, reopenYearAction } from "../extra-actions";
import { AccountingTabs, ErrorNote, field } from "../ui";

export const dynamic = "force-dynamic";

export default async function YearEndPage({ searchParams }: PageProps<"/accounting/year-end">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const closed = await listClosedYears(ctx);
  const manage = can(ctx.role, "books.manage");
  // The year that just ended, the one most people close.
  const justEnded = fiscalYearOf(new Date(Date.parse(`${p.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10));
  const range = fiscalYearRange(justEnded);
  const alreadyClosed = closed.some((c) => c.fiscalYear === justEnded);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Year-end</h1>
      <AccountingTabs current="/accounting/year-end" />
      <ErrorNote error={sp.error} />
      <p className="text-sm text-stone-600">
        Closing a fiscal year brings every income and expense account back to zero and moves the profit (or loss) to &quot;Profit brought forward&quot;. After that nothing can be dated inside
        that year. Late bills and supplier payments are posted on the first open day instead. Check the profit and loss and balance sheet before you close. The owner can reopen the latest
        closed year if something was missed.
      </p>
      {manage && !alreadyClosed && (
        <form action={closeYearAction} className="card flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            Fiscal year to close
            <input name="fy" defaultValue={justEnded} pattern="\d{4}/\d{2}" required className={field} />
          </label>
          <p className="text-xs text-stone-500">{justEnded} runs from {range.from} to {range.to}.</p>
          <button className="min-h-10 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">Close the year</button>
        </form>
      )}
      <section className="card p-4">
        <h2 className="font-semibold">Closed years</h2>
        {closed.length === 0 && <p className="mt-1 text-sm text-stone-600">No year has been closed.</p>}
        <ul className="mt-1 divide-y divide-stone-100 text-sm">
          {closed.map((c, i) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <span>
                {c.fiscalYear} (closed to {c.date})
              </span>
              {manage && i === 0 && (
                <form action={reopenYearAction.bind(null, c.fiscalYear)}>
                  <button className="rounded border border-stone-300 px-3 py-1.5 text-sm">Reopen</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
