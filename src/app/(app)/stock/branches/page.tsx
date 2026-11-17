import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { db } from "@/server/db";
import { listStock } from "@/features/stock/server/service";
import { listIncoming, listTransferTargets, listTransfers, stockOverview } from "@/features/stock/server/transfers";
import { cancelTransferAction, receiveAction, transferAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "min-h-10 px-3 text-sm";
const STATUS = {
  OK: "text-stone-800",
  LOW: "bg-amber-100 text-amber-900",
  OUT: "bg-red-100 text-red-800",
  NEGATIVE: "bg-red-100 text-red-800",
} as const;

export default async function StockBranchesPage({ searchParams }: PageProps<"/stock/branches">) {
  const ctx = await requireTenant("stock.view");
  const { error } = await searchParams;
  const [overview, targets, transfers, incoming, mine, branch] = await Promise.all([
    stockOverview(ctx),
    listTransferTargets(ctx),
    listTransfers(ctx),
    listIncoming(ctx),
    listStock(ctx),
    db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId: ctx.businessId, id: ctx.branchId } }, select: { name: true } }),
  ]);
  const canMove = can(ctx.role, "stock.manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Stock across branches</h1>
          <p className="text-sm text-stone-500">Each branch keeps its own stock, reorder levels and average cost. Items and recipes are shared.</p>
        </div>
        <Link href="/stock" className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm leading-9 hover:bg-stone-50">
          Back to {branch.name}
        </Link>
      </div>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-semibold">Levels by branch</h2>
        {overview.rows.length === 0 ? (
          <p className="text-sm text-stone-500">No stock items yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Item</th>
                {overview.branches.map((b) => (
                  <th key={b.id} className={`py-2 pr-3 text-right font-medium ${b.id === ctx.branchId ? "text-brand-700" : ""}`}>
                    {b.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {overview.rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3">
                    {r.name} <span className="text-xs text-stone-400">{r.unit}</span>
                  </td>
                  {r.perBranch.map((p) => (
                    <td key={p.branchId} className="py-2 pr-3 text-right">
                      {p.stocked ? (
                        <span className={`inline-block rounded-md px-2 py-0.5 ${STATUS[p.status]}`}>{p.quantity.toLocaleString("en-GB")}</span>
                      ) : (
                        <span className="text-xs text-stone-400">not stocked</span>
                      )}
                      {p.onTheWay > 0 && <span className="ml-1 text-xs text-sky-700">+{p.onTheWay.toLocaleString("en-GB")} on the way</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {overview.branches.length < 2 && <p className="mt-2 text-xs text-stone-500">Only one branch is shown. Add a branch on the Branches page to compare.</p>}
      </section>

      {incoming.length > 0 && (
        <section className="card space-y-3 border-sky-200 p-4">
          <h2 className="font-semibold">On its way to {branch.name}</h2>
          <ul className="space-y-3">
            {incoming.map((t) => (
              <li key={t.id} className="rounded-xl bg-sky-50 p-3 text-sm">
                <p className="font-medium">
                  {t.quantity.toLocaleString("en-GB")} {t.stockItem.unit} of {t.stockItem.name} from {t.from.name}
                  {t.note && <span className="font-normal text-stone-600"> · {t.note}</span>}
                </p>
                {canMove && (
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <form action={receiveAction.bind(null, t.id)} className="flex flex-wrap items-end gap-2">
                      <label className="text-xs font-medium text-stone-600">
                        How much arrived
                        <input name="received" type="number" min={0} max={t.quantity} step={1} placeholder={String(t.quantity)} className={`mt-1 block w-28 ${field}`} />
                      </label>
                      <button className="btn-primary">Book it in</button>
                    </form>
                    <form action={cancelTransferAction.bind(null, t.id)} className="flex items-end gap-2">
                      <input name="reason" maxLength={200} placeholder="Why (optional)" aria-label="Reason for sending it back" className={`w-44 ${field}`} />
                      <button className="min-h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm hover:bg-stone-50">Refuse, send back</button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-stone-500">Leave the count blank if it all came. If less came, enter what you counted; the difference is recorded as lost on the way.</p>
        </section>
      )}

      {canMove && (
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Send stock from {branch.name}</h2>
          {targets.length === 0 ? (
            <p className="text-sm text-stone-500">There is no other active branch to send to.</p>
          ) : mine.length === 0 ? (
            <p className="text-sm text-stone-500">No stock items yet.</p>
          ) : (
            <form action={transferAction} className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium">
                Item
                <select name="stockItemId" required className={`mt-1 block ${field}`}>
                  {mine.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.quantity.toLocaleString("en-GB")} {i.unit} here)
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                Quantity
                <input name="quantity" type="number" min={1} step={1} required className={`mt-1 block w-28 ${field}`} />
              </label>
              <label className="text-sm font-medium">
                To branch
                <select name="toBranchId" required className={`mt-1 block ${field}`}>
                  {targets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                Note (optional)
                <input name="note" maxLength={200} className={`mt-1 block w-56 ${field}`} />
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="arrivesNow" /> Arrives straight away
              </label>
              <button className="btn-primary">Send</button>
            </form>
          )}
          <p className="text-xs text-stone-500">
            The stock leaves this branch now and stays <strong>on its way</strong> until the other branch books it in. Tick &ldquo;arrives straight away&rdquo; for
            something carried over at once. It travels at this branch&rsquo;s average cost. You cannot send more than is here.
          </p>
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Recent transfers at {branch.name}</h2>
        {transfers.length === 0 ? (
          <p className="text-sm text-stone-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {transfers.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span
                    className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.status === "IN_TRANSIT" ? "bg-sky-100 text-sky-800" : t.status === "CANCELLED" ? "bg-stone-200 text-stone-700" : t.direction === "OUT" ? "bg-orange-100 text-orange-800" : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {t.status === "IN_TRANSIT" ? "On its way" : t.status === "CANCELLED" ? "Sent back" : t.direction === "OUT" ? "Sent" : "Received"}
                  </span>
                  {t.quantity.toLocaleString("en-GB")} {t.stockItem.unit} of {t.stockItem.name}{" "}
                  <span className="text-stone-500">
                    {t.direction === "OUT" ? `to ${t.to.name}` : `from ${t.from.name}`}
                    {t.note ? ` · ${t.note}` : ""}
                    {t.lost > 0 ? ` · ${t.lost.toLocaleString("en-GB")} ${t.stockItem.unit} lost on the way` : ""}
                  </span>
                </span>
                <span className="text-xs text-stone-400">
                  {t.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
