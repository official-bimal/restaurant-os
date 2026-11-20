import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { getCountSheet } from "@/features/stock/server/counts";
import { formatNpr } from "@/features/billing/calc";

export const dynamic = "force-dynamic";

export default async function CountSheetPage({ params }: PageProps<"/stock/count/[id]">) {
  const ctx = await requireTenant("stock.view");
  const { id } = await params;
  let data;
  try {
    data = await getCountSheet(ctx, id);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const { sheet, who, moves } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/stock/count" className="text-sm text-stone-500 hover:underline">
          ← Counts
        </Link>
        <h1 className="text-xl font-semibold">Count of {sheet.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</h1>
      </div>
      <p className="text-sm text-stone-600">
        {sheet.itemsCounted} item{sheet.itemsCounted === 1 ? "" : "s"} counted{who ? ` by ${who}` : ""}. {sheet.itemsChanged === 0 ? "Everything matched the book." : `${sheet.itemsChanged} different from the book.`}
        {sheet.note ? ` Note: ${sheet.note}` : ""}
      </p>
      {sheet.itemsChanged > 0 && (
        <p role="status" className={`rounded-lg p-3 text-sm ${sheet.valueChange < 0 ? "bg-red-50 text-red-800" : "bg-green-50 text-green-900"}`}>
          {sheet.valueChange < 0 ? `Stock worth ${formatNpr(-sheet.valueChange)} is missing.` : `Stock worth ${formatNpr(sheet.valueChange)} more than the book was found.`}
        </p>
      )}
      {moves.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="py-2 pr-3 text-right font-medium">Difference</th>
                <th className="py-2 text-right font-medium">Worth</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {moves.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 pr-3 font-medium">{m.stockItem.name}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${m.quantity < 0 ? "text-red-700" : "text-green-800"}`}>
                    {m.quantity > 0 ? "+" : ""}
                    {m.quantity.toLocaleString("en-GB")} {m.stockItem.unit}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatNpr(m.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
