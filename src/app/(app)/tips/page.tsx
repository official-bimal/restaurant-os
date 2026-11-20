import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { db } from "@/server/db";
import { addDays, isValidDate, localDate } from "@/lib/business-day";
import { formatNpr } from "@/features/billing/calc";
import { listTips, previewPayout } from "@/features/roster/server/service";
import { recordTipAction, sharePayoutAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

export default async function TipsPage({ searchParams }: PageProps<"/tips">) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const biz = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const today = localDate(new Date(), biz.timezone);
  const from = typeof sp.from === "string" && isValidDate(sp.from) ? sp.from : addDays(today, -13);
  const to = typeof sp.to === "string" && isValidDate(sp.to) ? sp.to : today;
  const basis = sp.basis === "EQUAL" ? "EQUAL" : "HOURS";
  const service = Math.min(100, Math.max(0, Number(typeof sp.service === "string" ? sp.service : "0") || 0));
  const record = can(ctx, "drawer.use");
  const owner = can(ctx, "payroll.manage");
  const t = await listTips(ctx, from, to);
  const preview = owner ? await previewPayout(ctx, { from, to, basis, servicePercent: service }).catch(() => null) : null;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Tips</h1>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}
      {sp.shared === "1" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Shared out and added to payroll as a bonus for each person.</p>}
      <p className="text-sm text-stone-600">
        Tips belong to staff, not the business. Record each tip as it is received (cash, card or QR); it is kept in the books as owed to staff. The owner then shares them out by hours worked (from the time clock) or equally, optionally with a share of the
        service charge, and each person&apos;s share is added to payroll as a bonus.
      </p>

      {record && (
        <form action={recordTipAction} className="card flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            Date
            <input type="date" name="date" defaultValue={today} max={today} required className={field} />
          </label>
          <label className="text-sm">
            Amount (Rs)
            <input name="amount" required inputMode="decimal" className={`${field} w-32`} />
          </label>
          <label className="text-sm">
            Paid by
            <select name="method" className={field} defaultValue="CASH">
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="QR">QR / wallet</option>
            </select>
          </label>
          <label className="min-w-[10rem] flex-1 text-sm">
            Note
            <input name="note" maxLength={80} className={field} placeholder="Table 4" />
          </label>
          <button className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">Record tip</button>
          <p className="w-full text-xs text-stone-500">A cash tip put in the drawer counts toward what the drawer should hold.</p>
        </form>
      )}

      <form className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          From
          <input type="date" name="from" defaultValue={from} className={field} />
        </label>
        <label className="text-sm">
          To
          <input type="date" name="to" defaultValue={to} className={field} />
        </label>
        {owner && (
          <>
            <label className="text-sm">
              Share
              <select name="basis" defaultValue={basis} className={field}>
                <option value="HOURS">By hours worked</option>
                <option value="EQUAL">Equally</option>
              </select>
            </label>
            <label className="text-sm">
              Service charge added (%)
              <input name="service" type="number" min={0} max={100} defaultValue={service} className={`${field} w-24`} />
            </label>
          </>
        )}
        <button className="min-h-10 rounded-lg border border-stone-300 px-4 text-sm font-medium">Show</button>
      </form>

      <p className="text-sm">
        Tips not yet shared in this period: <strong>{formatNpr(t.unshared)}</strong>.
      </p>

      {owner && preview && (
        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">Sharing out {from} to {to}</h2>
          <p className="text-sm text-stone-600">
            Tips {formatNpr(preview.tipsAmount)} ({preview.tipCount})
            {preview.serviceAmount > 0 ? ` plus ${formatNpr(preview.serviceAmount)} from the service charge (${service}% of ${formatNpr(preview.serviceCollected)})` : ""} = <strong>{formatNpr(preview.pooled)}</strong> to share.
          </p>
          {preview.lines.length === 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Nobody clocked in at this branch in this period, so there is no one to share with.</p>
          ) : (
            <table className="w-full max-w-md text-sm">
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.userId} className="border-b border-stone-100">
                    <td className="py-1.5">{l.name}</td>
                    <td className="py-1.5 text-stone-500">{hm(l.minutes)}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{formatNpr(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {preview.pooled > 0 && preview.lines.length > 0 && (
            <form action={sharePayoutAction}>
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="to" value={to} />
              <input type="hidden" name="basis" value={basis} />
              <input type="hidden" name="servicePercent" value={service} />
              <button className="min-h-11 rounded-lg bg-brand-600 px-6 font-medium text-white">Share out and add to payroll</button>
              <p className="mt-1 text-xs text-stone-500">Each person&apos;s share is added to payroll as a bonus for the month the period ends in. It cannot be done for a month whose payroll is finalized.</p>
            </form>
          )}
        </section>
      )}

      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[480px] text-sm">
          <tbody>
            {t.tips.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-stone-500">No tips recorded in this period.</td>
              </tr>
            )}
            {t.tips.map((x) => (
              <tr key={x.id} className="border-b border-stone-100">
                <td className="px-4 py-2 whitespace-nowrap">{x.date}</td>
                <td className="px-3 py-2">{x.method.toLowerCase()}</td>
                <td className="px-3 py-2 text-stone-500">{x.note}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatNpr(x.amount)}</td>
                <td className="px-4 py-2 text-xs text-stone-500">{x.payoutId ? "shared" : "waiting"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {owner && t.payouts.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Earlier sharing</h2>
          <ul className="space-y-2">
            {t.payouts.map((p) => (
              <li key={p.id} className="card p-4 text-sm">
                <p className="font-medium">
                  {p.fromDate} to {p.toDate}: {formatNpr(p.pooled)} {p.basis === "HOURS" ? "by hours" : "equally"}
                </p>
                <p className="text-stone-600">{p.lines.map((l) => `${l.name} ${formatNpr(l.amount)}`).join(", ")}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
