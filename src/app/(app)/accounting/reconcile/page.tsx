import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { currentPeriod, listAccounts } from "@/features/accounting/server/service";
import { getReconciliation } from "@/features/accounting/server/extras";
import { isValidDate } from "@/lib/business-day";
import { reconcileAction } from "../extra-actions";
import { AccountingTabs, Dates, ErrorNote, field, Money } from "../ui";

export const dynamic = "force-dynamic";

function toPaisa(raw: string | string[] | undefined): number | null {
  const t = (typeof raw === "string" ? raw : "").replace(/,/g, "").trim();
  return /^-?\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
}

export default async function ReconcilePage({ searchParams }: PageProps<"/accounting/reconcile">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const [accounts, p] = await Promise.all([listAccounts(ctx), currentPeriod(ctx)]);
  const candidates = accounts.filter((a) => a.type === "ASSET");
  const chosen = candidates.find((a) => a.id === sp.account) ?? candidates.find((a) => a.key === "BANK");
  const to = typeof sp.to === "string" && isValidDate(sp.to) ? sp.to : p.today;
  const rec = chosen ? await getReconciliation(ctx, chosen.id, to) : null;
  const statement = toPaisa(sp.balance);
  const manage = can(ctx, "books.manage");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Bank reconciliation</h1>
      <AccountingTabs current="/accounting/reconcile" />
      <ErrorNote error={sp.error} />
      <form className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Account
          <select name="account" defaultValue={chosen?.id} className={field}>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Statement date
          <input type="date" name="to" defaultValue={to} className={field} />
        </label>
        <label className="text-sm">
          Balance on the statement (Rs)
          <input name="balance" inputMode="decimal" defaultValue={typeof sp.balance === "string" ? sp.balance : ""} className={field} />
        </label>
        <button className="min-h-10 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Show</button>
      </form>
      {rec && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card p-4">
              <p className="text-sm text-stone-600">Balance in the books</p>
              <p className="text-xl font-semibold"><Money paisa={rec.bookBalance} /></p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-stone-600">Matched with the statement</p>
              <p className="text-xl font-semibold"><Money paisa={rec.matchedBalance} /></p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-stone-600">{statement === null ? "Enter the statement balance" : "Statement less matched"}</p>
              <p className={`text-xl font-semibold ${statement !== null && statement !== rec.matchedBalance ? "text-red-700" : "text-emerald-700"}`}>
                {statement === null ? "-" : <Money paisa={statement - rec.matchedBalance} />}
              </p>
            </div>
          </div>
          <p className="text-sm text-stone-600">
            Tick the lines that appear on the bank statement and save. When the statement balance equals the matched balance, the account agrees with the bank. Lines left unticked are
            things the bank has not shown yet (cheques not cashed, deposits in transit) or mistakes to look into.
          </p>
          <form action={reconcileAction.bind(null, rec.account.id)} className="card overflow-x-auto p-4">
            <input type="hidden" name="to" value={to} />
            <input type="hidden" name="balance" value={typeof sp.balance === "string" ? sp.balance : ""} />
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left text-stone-600">
                  {manage && <th className="w-10 py-1" />}
                  <th className="py-1">Date</th>
                  <th className="py-1">Voucher</th>
                  <th className="py-1">Details</th>
                  <th className="py-1 text-right">Debit</th>
                  <th className="py-1 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {rec.open.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-2 text-stone-600">
                      Every line up to this date is matched.
                    </td>
                  </tr>
                )}
                {rec.open.map((l) => (
                  <tr key={l.id} className="border-t border-stone-100">
                    {manage && (
                      <td className="py-1">
                        <input type="checkbox" name="line" value={l.id} aria-label={`Match ${l.narration}`} className="h-5 w-5" />
                      </td>
                    )}
                    <td className="py-1"><Dates date={l.date} /></td>
                    <td className="py-1 whitespace-nowrap">{l.number}</td>
                    <td className="py-1">{l.narration}</td>
                    <td className="py-1 text-right">{l.debit > 0 && <Money paisa={l.debit} />}</td>
                    <td className="py-1 text-right">{l.credit > 0 && <Money paisa={l.credit} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {manage && rec.open.length > 0 && (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  Statement date for these lines
                  <input type="date" name="statementDate" required defaultValue={to} className={field} />
                </label>
                <button className="min-h-10 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Mark ticked lines as matched</button>
              </div>
            )}
          </form>
        </>
      )}
    </div>
  );
}
