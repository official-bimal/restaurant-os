import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { listRecentInvoices } from "@/features/orders/server/bills";
import { formatNpr } from "@/features/billing/calc";

export const dynamic = "force-dynamic";

export default async function BillsPage({ searchParams }: PageProps<"/bills">) {
  const ctx = await requireTenant("bills.view");
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim().replace(/^#/, "") : "";
  const number = /^\d+$/.test(query) ? Number(query) : undefined;
  const invoices = await listRecentInvoices(ctx, number);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Bills</h1>
      <form method="get" className="flex max-w-sm items-end gap-2">
        <label className="flex-1 text-sm font-medium">
          Find by invoice number
          <input name="q" defaultValue={query} inputMode="numeric" placeholder="e.g. 12" className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2" />
        </label>
        <button className="min-h-11 rounded-lg border border-stone-300 px-4">Find</button>
      </form>

      <div className="overflow-x-auto rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        {invoices.length === 0 ? (
          <p className="text-stone-500">No bills yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Invoice</th>
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Table</th>
                <th className="py-2 pr-3 font-medium">Paid by</th>
                <th className="py-2 pr-3 text-right font-medium">Total</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-2 pr-3">
                    <Link href={`/orders/${inv.orderId}`} className="font-medium underline">
                      #{inv.number}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    {inv.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="py-2 pr-3">{inv.order.table?.label ?? "Takeaway"}</td>
                  <td className="py-2 pr-3">{[...new Set(inv.payments.map((p) => p.method.toLowerCase()))].join(", ")}</td>
                  <td className="py-2 pr-3 text-right">{formatNpr(inv.grandTotal)}</td>
                  <td className="py-2">
                    {(() => {
                      const back = inv.creditNotes.reduce((n, c) => n + c.grandTotal, 0);
                      if (back <= 0) return "Paid";
                      const nums = inv.creditNotes.map((c) => `#${c.number}`).join(", ");
                      return back >= inv.grandTotal ? (
                        <span className="text-red-700">Refunded (credit note {nums})</span>
                      ) : (
                        <span className="text-amber-800">
                          Part refunded {formatNpr(back)} (credit note {nums})
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
