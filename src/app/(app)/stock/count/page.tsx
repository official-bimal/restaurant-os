import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { listStock } from "@/features/stock/server/service";
import { listCountSheets } from "@/features/stock/server/counts";
import { formatNpr } from "@/features/billing/calc";
import { CountSheet } from "./count-sheet";

export const dynamic = "force-dynamic";

export default async function StockCountPage({ searchParams }: PageProps<"/stock/count">) {
  const ctx = await requireTenant("stock.view");
  const { error } = await searchParams;
  const manage = can(ctx, "stock.manage");
  const [items, sheets] = await Promise.all([manage ? listStock(ctx) : Promise.resolve([]), listCountSheets(ctx, 15)]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/stock" className="text-sm text-stone-500 hover:underline">
          ← Stock
        </Link>
        <h1 className="text-xl font-semibold">Count the shelves</h1>
      </div>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {manage ? (
        items.length === 0 ? (
          <p className="card p-4 text-stone-600">No stock items yet.</p>
        ) : (
          <>
            <p className="text-sm text-stone-600">
              Walk round, write down what is really there, and save. Leave an item blank to skip it. Count when nothing is being used, so the numbers do not move under you.
            </p>
            <CountSheet rows={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, book: i.quantity, costMilli: i.costMilli }))} />
          </>
        )
      ) : (
        <p className="card p-4 text-stone-600">Only a manager or the owner can count stock.</p>
      )}

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Earlier counts</h2>
        {sheets.length === 0 ? (
          <p className="text-sm text-stone-500">No counts yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {sheets.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <Link href={`/stock/count/${s.id}`} className="font-medium text-brand-700 hover:underline">
                  {s.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </Link>
                <span>
                  {s.itemsCounted} counted, {s.itemsChanged} different
                </span>
                {s.itemsChanged > 0 && <span className={s.valueChange < 0 ? "text-red-700" : "text-green-800"}>{s.valueChange < 0 ? `missing ${formatNpr(-s.valueChange)}` : `extra ${formatNpr(s.valueChange)}`}</span>}
                {s.note && <span className="text-stone-500">{s.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
