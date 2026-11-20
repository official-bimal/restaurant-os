import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { currentPeriod } from "@/features/accounting/server/service";
import { getCashBook, listMoneyAccounts } from "@/features/accounting/server/easy";
import { addMoneyAccountAction } from "../easy-actions";
import { ErrorNote, field, Money, pickRange, RangeForm } from "../ui";

export const dynamic = "force-dynamic";

export default async function CashBanksPage({ searchParams }: PageProps<"/accounting/cash-banks">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const { from, to } = pickRange(sp, { from: p.today, to: p.today });
  const [accounts, book] = await Promise.all([listMoneyAccounts(ctx), getCashBook(ctx, from, to)]);
  const manage = can(ctx, "books.manage");
  const total = accounts.filter((a) => a.active).reduce((n, a) => n + a.balance, 0);
  const cols = book.accounts;

  const block = (title: string, rows: typeof book.receipts, totals: typeof book.receiptsTotal) => (
    <>
      <tr className="bg-stone-50">
        <th colSpan={cols.length + 2} className="px-4 py-2 text-left text-sm font-semibold">
          {title}
        </th>
      </tr>
      {rows.length === 0 && (
        <tr>
          <td colSpan={cols.length + 2} className="px-4 py-2 text-stone-500">
            Nothing.
          </td>
        </tr>
      )}
      {rows.map((r) => (
        <tr key={r.row} className="border-t border-stone-100">
          <td className="px-4 py-2">{r.row}</td>
          {cols.map((c) => (
            <td key={c.id} className="px-3 py-2 text-right tabular-nums">
              {r.byAccount[c.id] ? <Money paisa={r.byAccount[c.id]!} /> : <span className="text-stone-300">-</span>}
            </td>
          ))}
          <td className="px-4 py-2 text-right font-medium tabular-nums">
            <Money paisa={r.total} />
          </td>
        </tr>
      ))}
      <tr className="border-t border-stone-300 font-semibold">
        <td className="px-4 py-2">Total {title.toLowerCase()}</td>
        {cols.map((c) => (
          <td key={c.id} className="px-3 py-2 text-right tabular-nums">
            <Money paisa={totals.byAccount[c.id] ?? 0} />
          </td>
        ))}
        <td className="px-4 py-2 text-right tabular-nums">
          <Money paisa={totals.all} />
        </td>
      </tr>
    </>
  );

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Cash and banks</h1>
      <ErrorNote error={sp.error} />

      <section aria-label="Balances" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {accounts.map((a) => (
          <Link key={a.id} href={`/accounting/ledger?account=${a.id}`} className={`card p-4 transition-colors hover:border-brand-500 ${a.active ? "" : "opacity-60"}`}>
            <p className="text-sm text-stone-500">{a.name}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              <Money paisa={a.balance} />
            </p>
            <p className="text-xs text-stone-400">{a.code}</p>
          </Link>
        ))}
        <div className="card bg-brand-50 p-4">
          <p className="text-sm text-brand-700">All together</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-brand-700">
            <Money paisa={total} />
          </p>
        </div>
      </section>

      {manage && (
        <form action={addMoneyAccountAction} className="card flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            Add a bank, cash box or wallet
            <input name="name" required maxLength={60} placeholder="Nabil Bank" className={field} />
          </label>
          <button className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">Add account</button>
          <Link href="/accounting/new?kind=TRANSFER" className="min-h-10 rounded-lg border border-stone-300 px-4 py-2 text-sm">
            Move money between accounts
          </Link>
        </form>
      )}

      <div>
        <h2 className="mb-2 text-lg font-semibold">Receipts and payments</h2>
        <RangeForm from={from} to={to} />
      </div>
      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-600">
              <th className="px-4 py-3 font-semibold">Account</th>
              {cols.map((c) => (
                <th key={c.id} className="px-3 py-3 text-right font-semibold">
                  {c.name}
                </th>
              ))}
              <th className="px-4 py-3 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="font-medium">
              <td className="px-4 py-2">Balance brought forward</td>
              {cols.map((c) => (
                <td key={c.id} className="px-3 py-2 text-right tabular-nums">
                  <Money paisa={book.opening[c.id] ?? 0} />
                </td>
              ))}
              <td className="px-4 py-2 text-right tabular-nums">
                <Money paisa={Object.values(book.opening).reduce((n, v) => n + v, 0)} />
              </td>
            </tr>
            {block("Receipts", book.receipts, book.receiptsTotal)}
            {block("Payments", book.payments, book.paymentsTotal)}
            <tr className="border-t-2 border-stone-300 bg-stone-50 font-semibold">
              <td className="px-4 py-3">Balance carried forward</td>
              {cols.map((c) => (
                <td key={c.id} className="px-3 py-3 text-right tabular-nums">
                  <Money paisa={book.closing[c.id] ?? 0} />
                </td>
              ))}
              <td className="px-4 py-3 text-right tabular-nums">
                <Money paisa={Object.values(book.closing).reduce((n, v) => n + v, 0)} />
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <p className="text-xs text-stone-500">
        Money in is a debit to the account and money out is a credit, shown by what it was for. A transfer shows as money out of one account and in to another. To count the cash in the drawer and close the day, use{" "}
        <Link href="/reports" className="text-brand-700 underline">
          Reports
        </Link>
        .
      </p>
    </div>
  );
}
