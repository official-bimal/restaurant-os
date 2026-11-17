import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { addDays, isValidDate, localDate } from "@/lib/business-day";
import { buildSummary, getOwnerSettings, listAlerts } from "@/features/owner/server/owner";
import { ALERT_LABEL, type AlertKind } from "@/features/owner/rules";
import { formatNpr } from "@/features/billing/calc";
import { listBlocks, listGaps } from "@/features/offline/server/blocks";
import { closeBlockAction, markSeenAction, saveOwnerSettingsAction, sendSummaryNowAction } from "./actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const rs = (paisa: number) => String(paisa / 100);

export default async function OwnerPage({ searchParams }: PageProps<"/owner">) {
  const ctx = await requireTenant("owner.control");
  const q = await searchParams;
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const today = localDate(new Date(), timezone);
  const date = typeof q.date === "string" && isValidDate(q.date) && q.date <= today ? q.date : today;
  const [summary, alerts, settings, blocks, gaps] = await Promise.all([buildSummary(ctx.businessId, date), listAlerts(ctx), getOwnerSettings(ctx), listBlocks(ctx), listGaps(ctx)]);
  const c = settings.config;
  const unseen = alerts.filter((a) => !a.seenAt).length;
  const monthStart = `${today.slice(0, 8)}01`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Owner control</h1>
          <p className="text-sm text-stone-500">Your daily summary, things worth checking, and the books for your accountant. Only the owner sees this page.</p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <label className="text-sm font-medium">
            Day
            <input type="date" name="date" max={today} defaultValue={date} className="mt-1 block px-3 py-2 text-sm" />
          </label>
          <button className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm">Show</button>
          {date !== today && (
            <Link href="/owner" className="min-h-10 rounded-lg bg-brand-600 px-3 py-2 text-sm text-white">
              Today
            </Link>
          )}
        </form>
      </div>

      {typeof q.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {q.error}
        </p>
      )}
      {typeof q.note === "string" && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {q.note}
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Sales after refunds", formatNpr(summary.data.net)],
          ["Bills paid", String(summary.data.sales.count)],
          ["Cancelled bills", String(summary.data.cancelled.count)],
          ["Refunds", summary.data.refunds.count ? formatNpr(summary.data.refunds.total) : "none"],
        ].map(([k, v]) => (
          <div key={k} className="card p-3.5">
            <p className="text-xs text-stone-500">{k}</p>
            <p className="mt-1 text-xl font-semibold">{v}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">Daily summary</h2>
            {date === today && (
              <form action={sendSummaryNowAction}>
                <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm font-medium hover:bg-stone-50">Send me this now</button>
              </form>
            )}
          </div>
          <pre className="whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-3 font-mono text-[13px] leading-relaxed">{summary.full.join("\n")}</pre>
          <p className="mt-2 text-xs text-stone-500">
            &ldquo;Send me this now&rdquo; uses the channels you switched on below. Push goes to the phones that turned on alerts; text and email need a provider on the server.
          </p>
        </section>

        <section className="card p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">
              Things to check {unseen > 0 && <span className="ml-1 rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">{unseen} new</span>}
            </h2>
            {unseen > 0 && (
              <form action={markSeenAction}>
                <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm">Mark all seen</button>
              </form>
            )}
          </div>
          {alerts.length === 0 ? (
            <p className="text-sm text-stone-500">Nothing unusual so far. Alerts appear here when something goes past one of your limits.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {alerts.map((a) => (
                <li key={a.id} className={`py-2.5 ${a.seenAt ? "text-stone-500" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${a.level === "alert" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{ALERT_LABEL[a.kind as AlertKind] ?? a.kind}</span>
                    <span className="font-medium text-stone-900">{a.title}</span>
                    <span className="ml-auto text-xs text-stone-500">{a.date}</span>
                  </div>
                  <p className="mt-1">{a.detail}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-stone-500">An alert says what was counted, not why. It is a prompt to look at the bills, not a finding against anyone.</p>
        </section>
      </div>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Offline invoice numbers</h2>
        <p className="text-sm text-stone-600">
          A phone that bills with no connection is given a run of invoice numbers in advance, taken from the same counter as every other bill, so a number is never used twice. Every number is either on an
          invoice or listed here as a gap, with the reason. Bills made offline are numbered when the sale happens but reach the server later, so numbers are not always in time order across phones: check with your accountant
          that this suits you.
        </p>
        {blocks.length === 0 ? (
          <p className="text-sm text-stone-500">No phone has been given numbers yet. It happens the first time a cashier opens Quick order while online.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Numbers</th>
                  <th className="py-1 pr-3 font-medium">Given to</th>
                  <th className="py-1 pr-3 text-right font-medium">Used</th>
                  <th className="py-1 pr-3 text-right font-medium">Gaps</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {blocks.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2 pr-3 font-medium">#{b.fromNumber} to #{b.toNumber}</td>
                    <td className="py-2 pr-3">
                      {b.user} <span className="text-xs text-stone-500">phone {b.deviceId.slice(0, 6)}</span>
                    </td>
                    <td className="py-2 pr-3 text-right">{b.invoiced} of {b.size}</td>
                    <td className="py-2 pr-3 text-right">{b.gaps}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${b.status === "OPEN" ? "bg-emerald-100 text-emerald-900" : "bg-stone-200 text-stone-700"}`}>{b.status.toLowerCase()}</span>
                    </td>
                    <td className="py-2">
                      {b.status === "OPEN" && (
                        <details>
                          <summary className="cursor-pointer text-xs text-stone-600 underline">Close</summary>
                          <form action={closeBlockAction.bind(null, b.id)} className="mt-1 flex flex-wrap items-end gap-2">
                            <input name="reason" required minLength={3} maxLength={200} placeholder="Why (for the record)" className="px-2 py-1 text-sm" />
                            <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-xs">Close and list unused numbers</button>
                          </form>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {gaps.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-stone-700">Numbers with no invoice ({gaps.length})</h3>
            <p className="mt-1 break-words text-sm text-stone-600">{gaps.slice(0, 60).map((g) => `#${g.number}`).join(", ")}{gaps.length > 60 ? " …" : ""}</p>
            <p className="mt-1 text-xs text-stone-500">{gaps[0]!.reason}. If a phone sends a bill later with one of these numbers, the gap is removed and the bill takes its place. All gaps are in the accountant&apos;s Excel file.</p>
          </div>
        )}
      </section>

      <form action={saveOwnerSettingsAction} className="card space-y-4 p-4">
        <h2 className="font-semibold">Settings</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-stone-700">Daily summary</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="summaryEnabled" defaultChecked={c.summaryEnabled} className="h-4 w-4" /> Send me a summary every day
            </label>
            <label className="block text-sm font-medium">
              Send it after (hour, 0 to 23)
              <input name="summaryHour" type="number" min={0} max={23} defaultValue={c.summaryHour} className={input + " w-28"} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="channelPush" defaultChecked={c.channelPush} className="h-4 w-4" /> Push notification (needs alerts turned on on your phone)
            </label>
            <label className="block text-sm font-medium">
              Text message to
              <input name="smsPhone" defaultValue={c.smsPhone ?? ""} placeholder="98XXXXXXXX" className={input} />
              <span className="text-xs font-normal text-stone-500">{settings.smsProvider ? `${settings.smsProvider} is set up on this server.` : "No text-message provider is set up on this server yet, so this cannot send."}</span>
            </label>
            <label className="block text-sm font-medium">
              Email to
              <input name="email" type="email" defaultValue={c.email ?? ""} placeholder="you@example.com" className={input} />
              <span className="text-xs font-normal text-stone-500">{settings.emailProvider ? `${settings.emailProvider} is set up on this server.` : "No email service is set up on this server yet, so this cannot send."}</span>
            </label>
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-stone-700">Alerts: tell me when, in one day</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="alertsEnabled" defaultChecked={c.alertsEnabled} className="h-4 w-4" /> Watch for unusual activity
            </label>
            <p className="text-xs text-stone-500">Enter 0 to switch one check off.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-medium">
                Bills cancelled (count)
                <input name="alertVoidCount" type="number" min={0} defaultValue={c.alertVoidCount} className={input} />
              </label>
              <label className="text-sm font-medium">
                Cancelled value (Rs)
                <input name="alertVoidAmount" type="number" min={0} step="1" defaultValue={rs(c.alertVoidAmount)} className={input} />
              </label>
              <label className="text-sm font-medium">
                One bill discount (%)
                <input name="alertDiscountPct" type="number" min={0} max={100} defaultValue={c.alertDiscountPct} className={input} />
              </label>
              <label className="text-sm font-medium">
                Discounts, share of sales (%)
                <input name="alertDiscountSharePct" type="number" min={0} max={100} step="0.5" defaultValue={c.alertDiscountShareBps / 100} className={input} />
              </label>
              <label className="text-sm font-medium">
                One refund of (Rs)
                <input name="alertRefundAmount" type="number" min={0} step="1" defaultValue={rs(c.alertRefundAmount)} className={input} />
              </label>
              <label className="text-sm font-medium">
                Cash off by (Rs)
                <input name="alertCashDiff" type="number" min={0} step="1" defaultValue={rs(c.alertCashDiff)} className={input} />
              </label>
            </div>
          </div>
        </div>
        <button className="min-h-11 rounded-lg bg-brand-600 px-4 font-medium text-white hover:bg-brand-700">Save</button>
      </form>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Books for your accountant</h2>
        <p className="text-sm text-stone-600">
          One Excel file with daily totals, every bill, payments by method, refunds, cancelled bills and supplier bills for the period you choose. Amounts are in rupees.
        </p>
        <form method="get" action="/api/export/accountant" className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">
            From
            <input type="date" name="from" defaultValue={monthStart} max={today} required className="mt-1 block px-3 py-2 text-sm" />
          </label>
          <label className="text-sm font-medium">
            To
            <input type="date" name="to" defaultValue={today} max={today} required className="mt-1 block px-3 py-2 text-sm" />
          </label>
          <button className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">Download Excel</button>
          <Link href={`/api/export/accountant?from=${addDays(today, -6)}&to=${today}`} className="min-h-10 rounded-lg border border-stone-300 px-3 py-2 text-sm">
            Last 7 days
          </Link>
        </form>
        <p className="text-xs text-stone-500">It is a record of what the app holds, not a tax return. A period can be up to a year.</p>
      </section>
    </div>
  );
}
