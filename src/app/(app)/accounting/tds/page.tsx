import { requireTenant } from "@/server/auth";
import { currentPeriod } from "@/features/accounting/server/service";
import { getTdsReport } from "@/features/accounting/server/extras";
import { AccountingTabs, Money, pickRange, RangeForm } from "../ui";

export const dynamic = "force-dynamic";

export default async function TdsPage({ searchParams }: PageProps<"/accounting/tds">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const { from, to } = pickRange(sp, { from: p.from, to: p.today });
  const { months, total } = await getTdsReport(ctx, from, to);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">TDS (tax deducted at source)</h1>
      <AccountingTabs current="/accounting/tds" />
      <RangeForm from={from} to={to} />
      <p className="text-sm text-stone-600">
        Tax kept back when paying suppliers, set on each supplier bill (Stock, bills: &quot;TDS kept back&quot;). It is owed to IRD, normally by the 25th of the next Nepali month. The rate depends on
        what was paid for (rent, services, commission and so on): check the current rates with your accountant. Once you deposit it, record the payment as a voucher: debit &quot;TDS payable&quot;, credit bank.
      </p>
      {months.length === 0 && <p className="card p-4 text-stone-600">No tax was deducted in this period.</p>}
      {months.map((m) => (
        <section key={m.month} className="card overflow-x-auto p-4">
          <h2 className="font-semibold">
            {m.monthName} <span className="text-sm font-normal text-stone-600">(deposit by {m.dueBy})</span>
          </h2>
          <table className="mt-2 w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-stone-600">
                <th className="py-1">Miti (BS)</th>
                <th className="py-1">Supplier</th>
                <th className="py-1">PAN</th>
                <th className="py-1">Bill</th>
                <th className="py-1 text-right">Bill total</th>
                <th className="py-1 text-right">TDS</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r, i) => (
                <tr key={i} className="border-t border-stone-100">
                  <td className="py-1 whitespace-nowrap">{r.bs}</td>
                  <td className="py-1">{r.supplier}</td>
                  <td className="py-1">{r.pan ?? <span className="text-red-700">missing</span>}</td>
                  <td className="py-1">{r.bill}</td>
                  <td className="py-1 text-right"><Money paisa={r.gross} /></td>
                  <td className="py-1 text-right"><Money paisa={r.tds} /></td>
                </tr>
              ))}
              <tr className="border-t-2 border-stone-300 font-semibold">
                <td className="py-1" colSpan={5}>Total for the month</td>
                <td className="py-1 text-right"><Money paisa={m.total} /></td>
              </tr>
            </tbody>
          </table>
        </section>
      ))}
      {months.length > 0 && <p className="text-right font-semibold">Total in period: <Money paisa={total} /></p>}
    </div>
  );
}
