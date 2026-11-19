import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { ACCOUNT_TYPES } from "@/features/accounting/chart";
import { listAccounts } from "@/features/accounting/server/service";
import { createAccountAction, updateAccountAction } from "../actions";
import { AccountingTabs, ErrorNote, field, TYPE_LABEL } from "../ui";

export const dynamic = "force-dynamic";

export default async function AccountsPage({ searchParams }: PageProps<"/accounting/accounts">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const accounts = await listAccounts(ctx);
  const manage = can(ctx.role, "books.manage");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Chart of accounts</h1>
      <AccountingTabs current="/accounting/accounts" />
      <ErrorNote error={sp.error} />
      {manage && (
        <form action={createAccountAction} className="card flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            Code
            <input name="code" required maxLength={12} className={field} placeholder="5250" />
          </label>
          <label className="text-sm">
            Name
            <input name="name" required maxLength={80} className={field} />
          </label>
          <label className="text-sm">
            Kind
            <select name="type" className={field} defaultValue="EXPENSE">
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <button className="min-h-10 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Add account</button>
        </form>
      )}
      {ACCOUNT_TYPES.map((t) => (
        <section key={t} className="card overflow-x-auto p-4">
          <h2 className="font-semibold">{TYPE_LABEL[t]}</h2>
          <table className="mt-2 w-full min-w-[420px] text-sm">
            <tbody>
              {accounts
                .filter((a) => a.type === t)
                .map((a) => (
                  <tr key={a.id} className="border-t border-stone-100">
                    <td className={`py-1 ${a.active ? "" : "text-stone-400 line-through"}`}>
                      {a.code} {a.name}
                    </td>
                    <td className="py-1 text-xs text-stone-500">{a.key ? "Used by the software" : ""}</td>
                    <td className="py-1 text-right">
                      {manage && !a.key && (
                        <form action={updateAccountAction.bind(null, a.id)}>
                          <input type="hidden" name="active" value={a.active ? "0" : "1"} />
                          <button className="rounded border border-stone-300 px-2 py-1 text-xs">{a.active ? "Switch off" : "Switch on"}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
