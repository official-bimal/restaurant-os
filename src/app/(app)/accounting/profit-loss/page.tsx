import { requireTenant } from "@/server/auth";
import { currentPeriod, getProfitAndLoss } from "@/features/accounting/server/service";
import type { Section } from "@/features/accounting/books";
import { AccountingTabs, Money, pickRange, RangeForm } from "../ui";

export const dynamic = "force-dynamic";

function Block({ title, s }: { title: string; s: Section }) {
  return (
    <section className="card p-4">
      <h2 className="font-semibold">{title}</h2>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {s.rows.length === 0 && (
            <tr>
              <td className="py-1 text-stone-600">Nothing in this period.</td>
            </tr>
          )}
          {s.rows.map((r) => (
            <tr key={r.account.id} className="border-t border-stone-100">
              <td className="py-1">{r.account.code} {r.account.name}</td>
              <td className="py-1 text-right"><Money paisa={r.amount} /></td>
            </tr>
          ))}
          <tr className="border-t-2 border-stone-300 font-semibold">
            <td className="py-1">Total {title.toLowerCase()}</td>
            <td className="py-1 text-right"><Money paisa={s.total} /></td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export default async function ProfitLossPage({ searchParams }: PageProps<"/accounting/profit-loss">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const { from, to } = pickRange(sp, { from: p.from, to: p.today });
  const r = await getProfitAndLoss(ctx, from, to);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Profit and loss</h1>
      <AccountingTabs current="/accounting/profit-loss" />
      <RangeForm from={from} to={to} />
      <Block title="Income" s={r.income} />
      <Block title="Expenses" s={r.expenses} />
      <p className={`card p-4 text-lg font-semibold ${r.profit < 0 ? "text-red-700" : "text-emerald-700"}`}>
        {r.profit >= 0 ? "Net profit" : "Net loss"}: <Money paisa={r.profit} />
      </p>
    </div>
  );
}
