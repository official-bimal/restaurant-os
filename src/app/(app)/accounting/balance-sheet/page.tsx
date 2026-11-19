import { requireTenant } from "@/server/auth";
import { currentPeriod, getBalanceSheet } from "@/features/accounting/server/service";
import type { Section } from "@/features/accounting/books";
import { AccountingTabs, Money, pickRange, RangeForm } from "../ui";

export const dynamic = "force-dynamic";

function Block({ title, s, extra }: { title: string; s: Section; extra?: { label: string; paisa: number } }) {
  const total = s.total + (extra?.paisa ?? 0);
  return (
    <section className="card p-4">
      <h2 className="font-semibold">{title}</h2>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.account.id} className="border-t border-stone-100">
              <td className="py-1">{r.account.code} {r.account.name}</td>
              <td className="py-1 text-right"><Money paisa={r.amount} /></td>
            </tr>
          ))}
          {extra && (
            <tr className="border-t border-stone-100">
              <td className="py-1">{extra.label}</td>
              <td className="py-1 text-right"><Money paisa={extra.paisa} /></td>
            </tr>
          )}
          <tr className="border-t-2 border-stone-300 font-semibold">
            <td className="py-1">Total {title.toLowerCase()}</td>
            <td className="py-1 text-right"><Money paisa={total} /></td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export default async function BalanceSheetPage({ searchParams }: PageProps<"/accounting/balance-sheet">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const { to } = pickRange({ to: sp.to }, { from: p.today, to: p.today });
  const b = await getBalanceSheet(ctx, to);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Balance sheet</h1>
      <AccountingTabs current="/accounting/balance-sheet" />
      <RangeForm from={to} to={to} single />
      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="Assets" s={b.assets} />
        <div className="space-y-4">
          <Block title="Liabilities" s={b.liabilities} />
          <Block title="Equity" s={b.equity} extra={{ label: "Profit so far (income less expenses)", paisa: b.profit }} />
        </div>
      </div>
      <p className={`rounded-lg px-3 py-2 text-sm ${b.difference === 0 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
        {b.difference === 0 ? "Assets equal liabilities plus equity." : "The balance sheet does not balance. Please check recent vouchers."}
      </p>
    </div>
  );
}
