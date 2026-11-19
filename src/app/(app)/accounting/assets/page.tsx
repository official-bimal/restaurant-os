import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { currentPeriod } from "@/features/accounting/server/service";
import { listAssets } from "@/features/accounting/server/extras";
import { addAssetAction, depreciationAction, disposeAssetAction } from "../extra-actions";
import { AccountingTabs, ErrorNote, field, Money } from "../ui";

export const dynamic = "force-dynamic";

export default async function AssetsPage({ searchParams }: PageProps<"/accounting/assets">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const assets = await listAssets(ctx);
  const manage = can(ctx.role, "books.manage");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Fixed assets</h1>
      <AccountingTabs current="/accounting/assets" />
      <ErrorNote error={sp.error} />
      {typeof sp.done === "string" && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Depreciation recorded for {sp.done} asset{sp.done === "1" ? "" : "s"} (nothing more to record if 0).</p>
      )}
      <p className="text-sm text-stone-600">
        Equipment and furniture that last for years. Each fiscal year it loses a share of the value it has left. In the year it is bought or sold it loses only the part of the year it was
        owned. This works asset by asset; income tax in Nepal groups assets into blocks with their own rates, so ask your accountant which rate to use.
      </p>
      {manage && (
        <form action={addAssetAction} className="card flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            Name
            <input name="name" required maxLength={80} className={field} placeholder="Pizza oven" />
          </label>
          <label className="text-sm">
            Cost (Rs)
            <input name="cost" required inputMode="decimal" className={`${field} w-32`} />
          </label>
          <label className="text-sm">
            Bought on
            <input type="date" name="purchaseDate" required defaultValue={p.today} max={p.today} className={field} />
          </label>
          <label className="text-sm">
            Yearly rate (%)
            <input name="rate" required inputMode="decimal" defaultValue="15" className={`${field} w-24`} />
          </label>
          <label className="text-sm">
            Paid from
            <select name="paidFrom" className={field} defaultValue="BANK">
              <option value="CASH">Cash</option>
              <option value="BANK">Bank</option>
              <option value="OWED">Still owed (on credit)</option>
            </select>
          </label>
          <button className="min-h-10 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">Add asset</button>
        </form>
      )}
      <section className="card overflow-x-auto p-4">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="py-1">Asset</th>
              <th className="py-1">Bought</th>
              <th className="py-1 text-right">Cost</th>
              <th className="py-1 text-right">Rate</th>
              <th className="py-1 text-right">Depreciation so far</th>
              <th className="py-1 text-right">Value now</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {assets.length === 0 && (
              <tr>
                <td colSpan={7} className="py-2 text-stone-600">
                  No assets yet.
                </td>
              </tr>
            )}
            {assets.map((a) => (
              <tr key={a.id} className="border-t border-stone-100">
                <td className="py-1">
                  {a.name} {a.disposedOn && <span className="text-xs text-stone-500">(sold or scrapped {a.disposedOn})</span>}
                </td>
                <td className="py-1 whitespace-nowrap">{a.purchaseDate}</td>
                <td className="py-1 text-right"><Money paisa={a.cost} /></td>
                <td className="py-1 text-right">{a.rateBps / 100}%</td>
                <td className="py-1 text-right"><Money paisa={a.accumulated} /></td>
                <td className="py-1 text-right"><Money paisa={a.bookValue} /></td>
                <td className="py-1 text-right">
                  {manage && !a.disposedOn && (
                    <form action={disposeAssetAction.bind(null, a.id)} className="flex items-center justify-end gap-1">
                      <input type="date" name="date" required defaultValue={p.today} min={a.purchaseDate} className="rounded border border-stone-300 px-1 py-1 text-xs" aria-label="Date sold or scrapped" />
                      <button className="rounded border border-stone-300 px-2 py-1 text-xs">Sold / scrapped</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-stone-500">Marking an asset as sold stops its depreciation. Record any money received, and the gain or loss, with a voucher.</p>
      </section>
      {manage && assets.length > 0 && (
        <form action={depreciationAction} className="card flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            Fiscal year
            <input name="fy" defaultValue={p.fiscalYear} pattern="\d{4}/\d{2}" required className={field} />
          </label>
          <button className="min-h-10 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">Record depreciation for this year</button>
          <p className="text-xs text-stone-500">An asset is charged once a year, so running this again only adds assets bought since.</p>
        </form>
      )}
    </div>
  );
}
