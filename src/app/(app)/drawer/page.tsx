import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { formatNpr } from "@/features/billing/calc";
import { MOVE_KINDS, MOVE_LABEL, isMoneyIn } from "@/features/drawer/drawer";
import { getDrawer } from "@/features/drawer/server/service";
import { closeDrawerAction, moveCashAction, openDrawerAction } from "./actions";
import { CountForm } from "./count-form";

export const dynamic = "force-dynamic";

const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kathmandu" });

export default async function DrawerPage({ searchParams }: PageProps<"/drawer">) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const d = await getDrawer(ctx);
  const use = can(ctx.role, "drawer.use");
  const c = d.current;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Cash drawer</h1>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}

      {!c && (
        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">The drawer is closed</h2>
          {use ? (
            <form action={openDrawerAction} className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                Float put in the drawer (Rs)
                <input name="float" required inputMode="decimal" defaultValue={d.lastCounted !== null ? String(d.lastCounted / 100) : ""} className={field} />
              </label>
              <button className="min-h-10 rounded-lg bg-brand-600 px-5 text-sm font-medium text-white">Open the drawer</button>
              {d.lastCounted !== null && <p className="w-full text-xs text-stone-500">Filled in with what was counted at the last handover.</p>}
            </form>
          ) : (
            <p className="text-sm text-stone-600">Nobody has opened it.</p>
          )}
        </section>
      )}

      {c && (
        <>
          <p className="text-sm text-stone-600">
            Opened {when(c.shift.openedAt)} by {d.who[c.shift.openedById] ?? "someone"}.
          </p>
          <section aria-label="What the drawer should hold" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {(
              [
                ["Float", c.openingFloat],
                ["Cash sales", c.cashSales],
                ["Cash refunds", -c.cashRefunds],
                ["Cash moved", c.movements.reduce((n, m) => n + (isMoneyIn(m.kind) ? m.amount : -m.amount), 0)],
                ["Cash tips", c.cashTips],
              ] as [string, number][]
            ).map(([label, v]) => (
              <div key={label} className="card p-3.5">
                <p className="text-sm text-stone-500">{label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{formatNpr(v)}</p>
              </div>
            ))}
            <div className="card bg-brand-50 p-3.5">
              <p className="text-sm text-brand-700">Should hold now</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-brand-700">{formatNpr(c.expected)}</p>
            </div>
          </section>

          {use && (
            <form action={moveCashAction} className="card flex flex-wrap items-end gap-3 p-4">
              <label className="text-sm">
                Cash in or out
                <select name="kind" className={field} defaultValue="BANK_DEPOSIT">
                  {MOVE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {MOVE_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Amount (Rs)
                <input name="amount" required inputMode="decimal" className={`${field} w-36`} />
              </label>
              <label className="min-w-[12rem] flex-1 text-sm">
                What for
                <input name="reason" required minLength={3} maxLength={120} className={field} placeholder="Evening deposit, gas cylinder…" />
              </label>
              <button className="min-h-10 rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-stone-50">Record</button>
            </form>
          )}

          {c.movements.length > 0 && (
            <section className="card overflow-x-auto p-0">
              <table className="w-full min-w-[480px] text-sm">
                <tbody>
                  {c.movements.map((m) => (
                    <tr key={m.id} className="border-b border-stone-100">
                      <td className="px-4 py-2 whitespace-nowrap text-stone-500">{when(m.createdAt)}</td>
                      <td className="px-3 py-2">
                        {MOVE_LABEL[m.kind]}: {m.reason}
                        <span className="block text-xs text-stone-500">{d.who[m.createdById] ?? ""}</span>
                      </td>
                      <td className={`px-4 py-2 text-right font-medium tabular-nums ${isMoneyIn(m.kind) ? "text-emerald-700" : "text-red-700"}`}>
                        {isMoneyIn(m.kind) ? "+" : "-"}
                        {formatNpr(m.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {use && <CountForm action={closeDrawerAction} expectedRupees={Math.round(c.expected / 100)} />}
        </>
      )}

      {d.canReview && d.history.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Earlier shifts</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
                  <th className="px-4 py-2 font-semibold">Closed</th>
                  <th className="px-3 py-2 font-semibold">By</th>
                  <th className="px-3 py-2 text-right font-semibold">Should hold</th>
                  <th className="px-3 py-2 text-right font-semibold">Counted</th>
                  <th className="px-3 py-2 text-right font-semibold">Difference</th>
                  <th className="px-4 py-2 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.id} className="border-b border-stone-100">
                    <td className="px-4 py-2 whitespace-nowrap">{h.closedAt ? when(h.closedAt) : ""}</td>
                    <td className="px-3 py-2">{d.who[h.closedById ?? ""] ?? ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNpr(h.expectedCash ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNpr(h.countedCash ?? 0)}</td>
                    <td className={`px-3 py-2 text-right font-medium tabular-nums ${!h.difference ? "text-emerald-700" : "text-red-700"}`}>{h.difference ? `${h.difference > 0 ? "+" : ""}${formatNpr(h.difference)}` : "matches"}</td>
                    <td className="px-4 py-2 text-stone-600">{h.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="text-xs text-stone-500">
        Cash moved out is posted to the books by what it was for (bank, expenses, the owner). A difference at the count is posted to &ldquo;Cash over and short&rdquo;, so the cash account agrees with what was really counted. The end-of-day cash count on Reports is separate.
      </p>
    </div>
  );
}
