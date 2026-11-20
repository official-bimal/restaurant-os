import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { currentPeriod, getDaybook } from "@/features/accounting/server/service";
import { reverseVoucherAction } from "../actions";
import { AccountingTabs, Dates, ErrorNote, field, Money, pickRange, RangeForm } from "../ui";

export const dynamic = "force-dynamic";

export default async function DaybookPage({ searchParams }: PageProps<"/accounting/daybook">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const { from, to } = pickRange(sp, { from: p.today, to: p.today });
  const { entries, totalDebit } = await getDaybook(ctx, from, to);
  const canFix = can(ctx, "books.manage");
  const back = `/accounting/daybook?from=${from}&to=${to}`;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Daybook</h1>
      <AccountingTabs current="/accounting/daybook" />
      <ErrorNote error={sp.error} />
      <RangeForm from={from} to={to} />
      <p className="text-sm text-stone-600">
        {entries.length} voucher{entries.length === 1 ? "" : "s"}, total <Money paisa={totalDebit} />.
      </p>
      {entries.length === 0 && <p className="card p-4 text-stone-600">Nothing was recorded in this period.</p>}
      {entries.map((e) => (
        <section key={e.id} className="card overflow-x-auto p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-semibold">
              {e.voucher} {e.fiscalYear} #{e.number}
            </h2>
            <span className="text-sm text-stone-600"><Dates date={e.date} /></span>
            {e.reversed && <span className="rounded bg-stone-200 px-2 py-0.5 text-xs">Reversed</span>}
          </div>
          <p className="mb-2 text-sm">{e.narration}</p>
          <table className="w-full min-w-[420px] text-sm">
            <tbody>
              {e.lines.map((l) => (
                <tr key={l.id} className="border-t border-stone-100">
                  <td className={`py-1 ${l.credit > 0 ? "pl-6" : ""}`}>
                    {l.account.code} {l.account.name}
                  </td>
                  <td className="py-1 text-right">{l.debit > 0 && <Money paisa={l.debit} />}</td>
                  <td className="py-1 text-right">{l.credit > 0 && <Money paisa={l.credit} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canFix && e.isManual && !e.reversed && (
            <form action={reverseVoucherAction.bind(null, back, e.id)} className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-sm">
                Reason
                <input name="reason" required maxLength={120} className={field} />
              </label>
              <button className="min-h-10 rounded-lg border border-stone-300 px-3 py-2 text-sm">Reverse this voucher</button>
            </form>
          )}
        </section>
      ))}
    </div>
  );
}
