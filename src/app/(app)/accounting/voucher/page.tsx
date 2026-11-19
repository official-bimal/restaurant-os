import { requireTenant } from "@/server/auth";
import { currentPeriod, listAccounts } from "@/features/accounting/server/service";
import { createVoucherAction } from "../actions";
import { AccountingTabs, ErrorNote, field } from "../ui";

export const dynamic = "force-dynamic";

export default async function VoucherPage({ searchParams }: PageProps<"/accounting/voucher">) {
  const ctx = await requireTenant("books.manage");
  const sp = await searchParams;
  const [accounts, p] = await Promise.all([listAccounts(ctx), currentPeriod(ctx)]);
  const usable = accounts.filter((a) => a.active);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New voucher</h1>
      <AccountingTabs current="/accounting/voucher" />
      <ErrorNote error={sp.error} />
      <form action={createVoucherAction} className="card space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Kind
            <select name="voucher" className={field} defaultValue="PAYMENT">
              <option value="PAYMENT">Payment (money out: an expense, a loan paid)</option>
              <option value="RECEIPT">Receipt (money in: other income, capital)</option>
              <option value="CONTRA">Contra (cash to bank or back)</option>
              <option value="JOURNAL">Journal (anything else)</option>
            </select>
          </label>
          <label className="text-sm">
            Date
            <input type="date" name="date" required defaultValue={p.today} max={p.today} className={field} />
          </label>
          <label className="text-sm sm:col-span-3">
            What it is for
            <input name="narration" required maxLength={200} className={field} placeholder="For example: Shop rent for Shrawan" />
          </label>
        </div>
        <p className="text-sm text-stone-600">
          Debit the account that gains (an expense, or the cash or bank that receives money) and credit the account that gives (the cash or bank that pays out,
          income, or capital). Total debits must equal total credits. Amounts are in rupees.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-stone-600">
                <th className="py-1">Account</th>
                <th className="w-32 py-1">Debit (Rs)</th>
                <th className="w-32 py-1">Credit (Rs)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }, (_, i) => (
                <tr key={i}>
                  <td className="pr-2 py-1">
                    <select name={`account${i}`} defaultValue="" aria-label={`Account for line ${i + 1}`} className="block w-full rounded-lg border border-stone-300 px-2 py-2">
                      <option value="">Choose an account…</option>
                      {usable.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="pr-2 py-1">
                    <input name={`debit${i}`} inputMode="decimal" aria-label={`Debit for line ${i + 1}`} className="block w-full rounded-lg border border-stone-300 px-2 py-2" />
                  </td>
                  <td className="py-1">
                    <input name={`credit${i}`} inputMode="decimal" aria-label={`Credit for line ${i + 1}`} className="block w-full rounded-lg border border-stone-300 px-2 py-2" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="min-h-11 rounded-lg bg-brand-600 px-5 py-2 font-medium text-white">Record voucher</button>
      </form>
    </div>
  );
}
