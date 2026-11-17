import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { listMovements } from "@/features/stock/server/service";
import { formatNpr } from "@/features/billing/calc";

export const dynamic = "force-dynamic";

const KIND = { PURCHASE: "Purchase", SALE: "Used by a sale", WASTE: "Waste", COUNT: "Count", TRANSFER_OUT: "Sent to a branch", TRANSFER_IN: "Received from a branch" } as const;

export default async function StockHistoryPage() {
  const ctx = await requireTenant("stock.view");
  const moves = await listMovements(ctx, { limit: 150 });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/stock" className="text-sm text-stone-500 hover:underline">
          ← Stock
        </Link>
        <h1 className="text-xl font-semibold">Stock history</h1>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        {moves.length === 0 ? (
          <p className="text-stone-500">Nothing recorded yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="py-2 pr-3 font-medium">What</th>
                <th className="py-2 pr-3 text-right font-medium">Change</th>
                <th className="py-2 pr-3 text-right font-medium">Value</th>
                <th className="py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {moves.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 pr-3">
                    {m.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="py-2 pr-3">{m.stockItem.name}</td>
                  <td className="py-2 pr-3">{KIND[m.kind]}</td>
                  <td className={`py-2 pr-3 text-right ${m.quantity < 0 ? "text-red-700" : "text-green-800"}`}>
                    {m.quantity > 0 ? "+" : ""}
                    {m.quantity.toLocaleString("en-GB")} {m.stockItem.unit}
                  </td>
                  <td className="py-2 pr-3 text-right">{formatNpr(m.totalCost)}</td>
                  <td className="py-2 text-stone-600">{[m.supplier, m.note].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
