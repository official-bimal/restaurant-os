import { requireTenant } from "@/server/auth";
import { currentPeriod, getTrialBalance } from "@/features/accounting/server/service";
import { AccountingTabs, Money, pickRange, RangeForm, TYPE_LABEL } from "../ui";

export const dynamic = "force-dynamic";

export default async function TrialBalancePage({ searchParams }: PageProps<"/accounting/trial-balance">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const { to } = pickRange({ to: sp.to }, { from: p.today, to: p.today });
  const tb = await getTrialBalance(ctx, to);
  const agree = tb.totalDebit === tb.totalCredit;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Trial balance</h1>
      <AccountingTabs current="/accounting/trial-balance" />
      <RangeForm from={to} to={to} single />
      <section className="card overflow-x-auto p-4">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="py-1">Account</th>
              <th className="py-1">Kind</th>
              <th className="py-1 text-right">Debit</th>
              <th className="py-1 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.account.id} className="border-t border-stone-100">
                <td className="py-1">{r.account.code} {r.account.name}</td>
                <td className="py-1 text-stone-600">{TYPE_LABEL[r.account.type]}</td>
                <td className="py-1 text-right">{r.debit > 0 && <Money paisa={r.debit} />}</td>
                <td className="py-1 text-right">{r.credit > 0 && <Money paisa={r.credit} />}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-stone-300 font-semibold">
              <td className="py-1" colSpan={2}>Total</td>
              <td className="py-1 text-right"><Money paisa={tb.totalDebit} /></td>
              <td className="py-1 text-right"><Money paisa={tb.totalCredit} /></td>
            </tr>
          </tbody>
        </table>
      </section>
      <p className={`rounded-lg px-3 py-2 text-sm ${agree ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
        {agree ? "Debits equal credits." : "Debits and credits differ. Please check recent vouchers."}
      </p>
    </div>
  );
}
