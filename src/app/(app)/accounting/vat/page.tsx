import { requireTenant } from "@/server/auth";
import { currentPeriod } from "@/features/accounting/server/service";
import { getVatSummary } from "@/features/accounting/server/registers";
import { AccountingTabs, Money, pickRange, RangeForm } from "../ui";

export const dynamic = "force-dynamic";

export default async function VatPage({ searchParams }: PageProps<"/accounting/vat">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const { from, to } = pickRange(sp, { from: p.from, to: p.today });
  const { months, totals } = await getVatSummary(ctx, from, to);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">VAT summary</h1>
      <AccountingTabs current="/accounting/vat" />
      <RangeForm from={from} to={to} />
      <section className="card overflow-x-auto p-4">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="py-1">Nepali month</th>
              <th className="py-1 text-right">Taxable sales</th>
              <th className="py-1 text-right">VAT collected</th>
              <th className="py-1 text-right">Taxable purchases</th>
              <th className="py-1 text-right">VAT paid</th>
              <th className="py-1 text-right">To pay / (carry forward)</th>
            </tr>
          </thead>
          <tbody>
            {months.length === 0 && (
              <tr>
                <td colSpan={6} className="py-2 text-stone-600">
                  Nothing in this period.
                </td>
              </tr>
            )}
            {months.map((m) => (
              <tr key={m.month} className="border-t border-stone-100">
                <td className="py-1">{m.monthName}</td>
                <td className="py-1 text-right"><Money paisa={m.taxableSales} /></td>
                <td className="py-1 text-right"><Money paisa={m.outputVat} /></td>
                <td className="py-1 text-right"><Money paisa={m.taxablePurchases} /></td>
                <td className="py-1 text-right"><Money paisa={m.inputVat} /></td>
                <td className="py-1 text-right"><Money paisa={m.net} /></td>
              </tr>
            ))}
            <tr className="border-t-2 border-stone-300 font-semibold">
              <td className="py-1">Total</td>
              <td className="py-1 text-right"><Money paisa={totals.taxableSales} /></td>
              <td className="py-1 text-right"><Money paisa={totals.outputVat} /></td>
              <td className="py-1 text-right"><Money paisa={totals.taxablePurchases} /></td>
              <td className="py-1 text-right"><Money paisa={totals.inputVat} /></td>
              <td className="py-1 text-right"><Money paisa={totals.net} /></td>
            </tr>
          </tbody>
        </table>
      </section>
      <p className="text-sm text-stone-600">
        Sales are net of credit notes. This is a working summary to help fill in the VAT return; it is not the return itself, and it only includes purchases
        entered with their VAT.
      </p>
    </div>
  );
}
