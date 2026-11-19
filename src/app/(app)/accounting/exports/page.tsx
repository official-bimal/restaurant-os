import { requireTenant } from "@/server/auth";
import { currentPeriod, listAccounts } from "@/features/accounting/server/service";
import { EXPORT_KINDS, EXPORT_LABEL } from "@/features/accounting/server/exports";
import { field, pickRange } from "../ui";

export const dynamic = "force-dynamic";

export default async function ExportsPage({ searchParams }: PageProps<"/accounting/exports">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const [p, accounts] = await Promise.all([currentPeriod(ctx), listAccounts(ctx)]);
  const { from, to } = pickRange(sp, { from: p.from, to: p.today });
  const account = typeof sp.account === "string" ? sp.account : (accounts.find((a) => a.key === "CASH")?.id ?? accounts[0]?.id ?? "");
  const link = (k: string) => `/accounting/export/${k}?from=${from}&to=${to}${k === "ledger" ? `&account=${account}` : ""}`;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Downloads for your accountant</h1>
      <p className="text-sm text-stone-600">
        Every book as a CSV file that opens in Excel or Google Sheets. Money is in rupees as plain numbers, so it can be added up. Choose the period, then download what you need.
      </p>
      <form className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          From
          <input type="date" name="from" defaultValue={from} className={field} />
        </label>
        <label className="text-sm">
          To (or &ldquo;as at&rdquo; for balance sheet and trial balance)
          <input type="date" name="to" defaultValue={to} className={field} />
        </label>
        <label className="text-sm">
          Account (for the ledger)
          <select name="account" defaultValue={account} className={field}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </label>
        <button className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">Use this period</button>
      </form>
      <ul className="card divide-y divide-stone-100">
        {EXPORT_KINDS.map((k) => (
          <li key={k} className="flex items-center justify-between gap-3 p-4">
            <span className="text-sm font-medium">{EXPORT_LABEL[k]}</span>
            <a href={link(k)} className="btn-secondary shrink-0">
              Download CSV
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-stone-500">
        The period is {from} to {to}. The balance sheet and trial balance are as at the second date. Fixed assets ignore the dates.
      </p>
    </div>
  );
}
