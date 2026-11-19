import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { currentPeriod } from "@/features/accounting/server/service";
import { listMoneyAccounts, listTransactions } from "@/features/accounting/server/easy";
import { TX_LABEL, type TxType } from "@/features/accounting/transactions";
import { bsText } from "@/features/accounting/fiscal";
import { ErrorNote, field, Money, pickRange } from "../ui";

export const dynamic = "force-dynamic";

const TYPES = Object.keys(TX_LABEL) as TxType[];
const PILL: Record<TxType, string> = {
  SALES: "bg-emerald-50 text-emerald-800",
  SALES_RETURN: "bg-rose-50 text-rose-800",
  PURCHASE: "bg-amber-50 text-amber-900",
  INCOME: "bg-teal-50 text-teal-800",
  EXPENSE: "bg-red-50 text-red-800",
  PAYMENT_IN: "bg-sky-50 text-sky-800",
  PAYMENT_OUT: "bg-violet-50 text-violet-800",
  TRANSFER: "bg-stone-100 text-stone-700",
  JOURNAL: "bg-stone-100 text-stone-700",
};

export default async function TransactionsPage({ searchParams }: PageProps<"/accounting/transactions">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const { from, to } = pickRange(sp, { from: p.from, to: p.today });
  const type = typeof sp.type === "string" && TYPES.includes(sp.type as TxType) ? sp.type : "";
  const account = typeof sp.account === "string" ? sp.account : "";
  const status = sp.status === "done" || sp.status === "reversed" ? sp.status : "";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 60) : "";
  const [accounts, r] = await Promise.all([listMoneyAccounts(ctx), listTransactions(ctx, { from, to, type: type || undefined, moneyAccountId: account || undefined, q: q || undefined, status: status || undefined })]);
  const manage = can(ctx.role, "books.manage");
  const cards: [string, number][] = [
    ["Sales", r.cards.sales],
    ["Purchase", r.cards.purchase],
    ["Income", r.cards.income],
    ["Expenses", r.cards.expenses],
    ["Payment in", r.cards.paymentIn],
    ["Payment out", r.cards.paymentOut],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Transactions</h1>
        {manage && (
          <Link href="/accounting/new" className="btn-primary">
            + Add an entry
          </Link>
        )}
      </div>
      <ErrorNote error={sp.error} />
      {sp.saved === "1" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</p>}

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, value]) => (
          <div key={label} className="card p-3.5">
            <p className="text-sm text-stone-500">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              <Money paisa={value} />
            </p>
          </div>
        ))}
      </section>

      <form className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          From
          <input type="date" name="from" defaultValue={from} className={field} />
        </label>
        <label className="text-sm">
          To
          <input type="date" name="to" defaultValue={to} className={field} />
        </label>
        <label className="text-sm">
          Type
          <select name="type" defaultValue={type} className={field}>
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TX_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Paid through
          <select name="account" defaultValue={account} className={field}>
            <option value="">All</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Status
          <select name="status" defaultValue={status} className={field}>
            <option value="">All</option>
            <option value="done">Done</option>
            <option value="reversed">Reversed</option>
          </select>
        </label>
        <label className="text-sm">
          Search
          <input name="q" defaultValue={q} placeholder="Name or details" className={field} />
        </label>
        <button className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">Show</button>
        <Link href="/accounting/transactions" className="min-h-10 rounded-lg border border-stone-300 px-4 py-2 text-sm">
          Clear
        </Link>
      </form>

      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-3 py-3 font-semibold">No.</th>
              <th className="px-3 py-3 font-semibold">Details</th>
              <th className="px-3 py-3 font-semibold">Type</th>
              <th className="px-3 py-3 font-semibold">Who</th>
              <th className="px-3 py-3 font-semibold">Through</th>
              <th className="px-3 py-3 text-right font-semibold">Amount</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-stone-500">
                  No transactions match.
                </td>
              </tr>
            )}
            {r.rows.map((t) => (
              <tr key={t.id} className={`border-b border-stone-100 ${t.reversed ? "text-stone-400" : ""}`}>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {t.date}
                  <span className="block text-xs text-stone-500">{bsText(t.date)} BS</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">{t.number}</td>
                <td className="max-w-[22rem] px-3 py-2.5">
                  <span className="line-clamp-2">{t.particular}</span>
                  {t.party && <span className="block text-xs text-stone-500">{t.party}</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${PILL[t.type]}`}>{t.typeLabel}</span>
                </td>
                <td className="px-3 py-2.5">{t.by}</td>
                <td className="px-3 py-2.5">{t.mode}</td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                  <Money paisa={t.amount} />
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-xs ${t.reversed ? "bg-stone-100 text-stone-600" : "bg-emerald-50 text-emerald-800"}`}>{t.reversed ? "Reversed" : "Done"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-stone-500">
        {r.total} transaction{r.total === 1 ? "" : "s"}
        {r.total > r.shown ? `, showing the latest ${r.shown}. Choose a shorter period to see the rest` : ""}. The totals above follow the dates, account, status and search you chose. Sales are after returns; transfers and journal entries are not counted in
        them. To undo a mistake, find the entry in the Day book and reverse it.
      </p>
    </div>
  );
}
