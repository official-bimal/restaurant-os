import { requireTenant } from "@/server/auth";
import { currentPeriod, getLedger, listAccounts } from "@/features/accounting/server/service";
import { AccountingTabs, Dates, field, Money, pickRange, RangeForm, TYPE_LABEL } from "../ui";

export const dynamic = "force-dynamic";

export default async function LedgerPage({ searchParams }: PageProps<"/accounting/ledger">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const [accounts, p] = await Promise.all([listAccounts(ctx), currentPeriod(ctx)]);
  const { from, to } = pickRange(sp, { from: p.from, to: p.today });
  const chosen = typeof sp.account === "string" ? accounts.find((a) => a.id === sp.account) : undefined;
  const book = chosen ? await getLedger(ctx, chosen.id, from, to) : null;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Ledger</h1>
      <AccountingTabs current="/accounting/ledger" />
      <RangeForm
        from={from}
        to={to}
        extra={
          <label className="text-sm">
            Account
            <select name="account" defaultValue={chosen?.id ?? ""} className={field}>
              <option value="">Choose an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {!book && <p className="card p-4 text-stone-600">Choose an account to see its ledger.</p>}
      {book && (
        <section className="card overflow-x-auto p-4">
          <h2 className="font-semibold">
            {book.account.code} {book.account.name} <span className="text-sm font-normal text-stone-600">({TYPE_LABEL[book.account.type]})</span>
          </h2>
          <table className="mt-2 w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-stone-600">
                <th className="py-1">Date</th>
                <th className="py-1">Voucher</th>
                <th className="py-1">Details</th>
                <th className="py-1 text-right">Debit</th>
                <th className="py-1 text-right">Credit</th>
                <th className="py-1 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-stone-100 font-medium">
                <td className="py-1" colSpan={5}>Brought forward</td>
                <td className="py-1 text-right"><Money paisa={book.broughtForward} /></td>
              </tr>
              {book.rows.map((r, i) => (
                <tr key={`${r.entryId}-${i}`} className="border-t border-stone-100">
                  <td className="py-1"><Dates date={r.date} /></td>
                  <td className="py-1 whitespace-nowrap">{r.number}</td>
                  <td className="py-1">{r.narration}</td>
                  <td className="py-1 text-right">{r.debit > 0 && <Money paisa={r.debit} />}</td>
                  <td className="py-1 text-right">{r.credit > 0 && <Money paisa={r.credit} />}</td>
                  <td className="py-1 text-right"><Money paisa={r.balance} /></td>
                </tr>
              ))}
              <tr className="border-t-2 border-stone-300 font-semibold">
                <td className="py-1" colSpan={3}>Totals and closing balance</td>
                <td className="py-1 text-right"><Money paisa={book.totalDebit} /></td>
                <td className="py-1 text-right"><Money paisa={book.totalCredit} /></td>
                <td className="py-1 text-right"><Money paisa={book.closing} /></td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
