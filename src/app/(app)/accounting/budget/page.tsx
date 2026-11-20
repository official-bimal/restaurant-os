import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { currentPeriod } from "@/features/accounting/server/service";
import { getBudgetReport } from "@/features/accounting/server/extras";
import { saveBudgetsAction } from "../extra-actions";
import { AccountingTabs, ErrorNote, field, Money } from "../ui";

export const dynamic = "force-dynamic";

export default async function BudgetPage({ searchParams }: PageProps<"/accounting/budget">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const fy = typeof sp.fy === "string" && /^\d{4}\/\d{2}$/.test(sp.fy) ? sp.fy : p.fiscalYear;
  const rows = await getBudgetReport(ctx, fy);
  const manage = can(ctx, "books.manage");
  const shown = rows.filter((r) => manage || r.budget !== 0 || r.actual !== 0);
  const tot = (type: "INCOME" | "EXPENSE") => rows.filter((r) => r.account.type === type).reduce((n, r) => ({ budget: n.budget + r.budget, actual: n.actual + r.actual }), { budget: 0, actual: 0 });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Budget</h1>
      <AccountingTabs current="/accounting/budget" />
      <ErrorNote error={sp.error} />
      <form className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Fiscal year
          <input name="fy" defaultValue={fy} pattern="\d{4}/\d{2}" className={field} />
        </label>
        <button className="min-h-10 rounded-lg border border-stone-300 px-4 py-2 text-sm">Show</button>
      </form>
      <p className="text-sm text-stone-600">
        What you expect to earn and spend this year, against what really happened so far. A positive difference means better than planned (more income, or less spent).
      </p>
      <form action={saveBudgetsAction.bind(null, fy)} className="card overflow-x-auto p-4">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="py-1">Account</th>
              <th className="w-40 py-1">Budget (Rs)</th>
              <th className="py-1 text-right">Actual</th>
              <th className="py-1 text-right">Difference</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.account.id} className="border-t border-stone-100">
                <td className="py-1">
                  {r.account.code} {r.account.name} <span className="text-xs text-stone-500">{r.account.type === "INCOME" ? "income" : "expense"}</span>
                </td>
                <td className="py-1 pr-2">
                  {manage ? (
                    <input name={`budget:${r.account.id}`} inputMode="decimal" defaultValue={r.budget ? String(r.budget / 100) : ""} aria-label={`Budget for ${r.account.name}`} className="block w-full rounded-lg border border-stone-300 px-2 py-1.5 text-right" />
                  ) : (
                    <Money paisa={r.budget} />
                  )}
                </td>
                <td className="py-1 text-right"><Money paisa={r.actual} /></td>
                <td className={`py-1 text-right ${r.budget === 0 ? "text-stone-400" : r.variance < 0 ? "text-red-700" : "text-emerald-700"}`}>{r.budget === 0 ? "-" : <Money paisa={r.variance} />}</td>
              </tr>
            ))}
            {(["INCOME", "EXPENSE"] as const).map((t) => {
              const x = tot(t);
              return (
                <tr key={t} className="border-t-2 border-stone-300 font-semibold">
                  <td className="py-1">Total {t === "INCOME" ? "income" : "expenses"}</td>
                  <td className="py-1 text-right"><Money paisa={x.budget} /></td>
                  <td className="py-1 text-right"><Money paisa={x.actual} /></td>
                  <td />
                </tr>
              );
            })}
          </tbody>
        </table>
        {manage && <button className="mt-3 min-h-10 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Save budget</button>}
      </form>
    </div>
  );
}
