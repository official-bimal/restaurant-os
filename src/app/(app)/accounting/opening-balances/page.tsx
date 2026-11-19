import { requireTenant } from "@/server/auth";
import { ACCOUNT_TYPES } from "@/features/accounting/chart";
import { currentPeriod, listAccounts } from "@/features/accounting/server/service";
import { openingBalancesAction } from "../extra-actions";
import { AccountingTabs, ErrorNote, field, TYPE_LABEL } from "../ui";

export const dynamic = "force-dynamic";

const cell = "block w-full rounded-lg border border-stone-300 px-2 py-1.5 text-right";

export default async function OpeningBalancesPage({ searchParams }: PageProps<"/accounting/opening-balances">) {
  const ctx = await requireTenant("books.manage");
  const sp = await searchParams;
  const [accounts, p] = await Promise.all([listAccounts(ctx), currentPeriod(ctx)]);
  const usable = accounts.filter((a) => a.active && a.key !== "RETAINED" && (a.type === "ASSET" || a.type === "LIABILITY" || a.type === "EQUITY"));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Opening balances</h1>
      <AccountingTabs current="/accounting/opening-balances" />
      <ErrorNote error={sp.error} />
      <p className="text-sm text-stone-600">
        What the business owned and owed on the day you start using these books: cash and bank balances, stock, equipment, money owed to suppliers, loans. Enter assets as debits and
        liabilities and capital as credits. The difference is put in &quot;Profit brought forward&quot; for you. Do this once; a mistake is put right by reversing the voucher in the daybook.
      </p>
      <form action={openingBalancesAction} className="card space-y-4 p-4">
        <label className="block w-48 text-sm">
          As at (the day before you started)
          <input type="date" name="date" required defaultValue={p.today} max={p.today} className={field} />
        </label>
        {ACCOUNT_TYPES.filter((t) => t === "ASSET" || t === "LIABILITY" || t === "EQUITY").map((t) => (
          <div key={t} className="overflow-x-auto">
            <h2 className="font-semibold">{TYPE_LABEL[t]}</h2>
            <table className="mt-1 w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-stone-600">
                  <th className="py-1">Account</th>
                  <th className="w-36 py-1">Debit (Rs)</th>
                  <th className="w-36 py-1">Credit (Rs)</th>
                </tr>
              </thead>
              <tbody>
                {usable
                  .filter((a) => a.type === t)
                  .map((a) => (
                    <tr key={a.id} className="border-t border-stone-100">
                      <td className="py-1">{a.code} {a.name}</td>
                      <td className="py-1 pr-2"><input name={`debit:${a.id}`} inputMode="decimal" aria-label={`Debit for ${a.name}`} className={cell} /></td>
                      <td className="py-1"><input name={`credit:${a.id}`} inputMode="decimal" aria-label={`Credit for ${a.name}`} className={cell} /></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
        <button className="min-h-11 rounded-lg bg-brand-600 px-5 py-2 font-medium text-white">Record opening balances</button>
      </form>
    </div>
  );
}
