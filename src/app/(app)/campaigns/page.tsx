import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { listCampaigns, segmentCounts } from "@/features/campaigns/server/service";
import { SEGMENTS, SEGMENT_INFO } from "@/features/campaigns/segments";
import { RULE_INFO } from "@/features/campaigns/automation";
import { formatNpr } from "@/features/billing/calc";
import { createCampaignAction } from "./actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  const ctx = await requireTenant("campaign.manage");
  const { error } = await searchParams;
  const [counts, campaigns] = await Promise.all([segmentCounts(ctx), listCampaigns(ctx)]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Campaigns</h1>
        <Link href="/campaigns/automatic" className="min-h-10 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium">
          Automatic campaigns
        </Link>
      </div>

      <p className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
        Campaigns prepare a message for each customer in a group. <strong>Nothing is sent unless you send it</strong>: you can copy each message and send it from
        your own phone, or, if your server has a messaging provider, the owner can press Send after seeing exactly how many will go. Only customers who agreed to
        offers, confirmed by staff in person, are included. For birthday and win-back messages that go out every day, see Automatic campaigns.
      </p>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Your customers</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SEGMENTS.map((s) => (
            <li key={s} className="rounded-2xl bg-white p-3 border border-stone-200 shadow-sm">
              <p className="font-medium">{SEGMENT_INFO[s].label}</p>
              <p className="text-2xl font-semibold">{counts[s].total}</p>
              <p className="text-xs text-stone-500">{SEGMENT_INFO[s].description}</p>
              <p className="mt-1 text-xs text-green-800">{counts[s].reachable} can be messaged</p>
            </li>
          ))}
        </ul>
      </section>

      <details className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <summary className="cursor-pointer font-semibold">New campaign</summary>
        <form action={createCampaignAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Name
            <input name="name" required maxLength={80} placeholder="e.g. Win back November" className={input} />
          </label>
          <label className="text-sm font-medium">
            Who is it for?
            <select name="segment" defaultValue="AT_RISK" className={input}>
              {SEGMENTS.filter((s) => s !== "NO_VISIT").map((s) => (
                <option key={s} value={s}>
                  {SEGMENT_INFO[s].label} ({counts[s].reachable} can be messaged)
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Message
            <textarea
              name="template"
              required
              rows={3}
              maxLength={320}
              defaultValue="Hi {name}, we miss you at {business}! Visit within {days} days and get {points} bonus points."
              className={input}
            />
            <span className="text-xs font-normal text-stone-500">
              You can use {"{name}"}, {"{business}"}, {"{points}"} and {"{days}"}. Keep it under 320 characters.
            </span>
          </label>
          <label className="text-sm font-medium">
            Bonus points if they come back (0 for none)
            <input name="offerPoints" type="number" min={0} max={10000} defaultValue={50} className={input} />
          </label>
          <label className="text-sm font-medium">
            Offer lasts (days after you send it)
            <input name="offerDays" type="number" min={1} max={90} defaultValue={14} className={input} />
          </label>
          <div className="sm:col-span-2">
            <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Create campaign</button>
          </div>
        </form>
      </details>

      <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="mb-2 font-semibold">Your campaigns</h2>
        {campaigns.length === 0 ? (
          <p className="text-sm text-stone-500">None yet. Create one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-stone-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Campaign</th>
                  <th className="py-2 pr-3 font-medium">For</th>
                  <th className="py-2 pr-3 text-right font-medium">Prepared</th>
                  <th className="py-2 pr-3 text-right font-medium">Sent</th>
                  <th className="py-2 pr-3 text-right font-medium">Came back</th>
                  <th className="py-2 pr-3 text-right font-medium">Claimed</th>
                  <th className="py-2 text-right font-medium">Sales from claims</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/campaigns/${c.id}`} className="font-medium underline">
                        {c.name}
                      </Link>
                      {!c.preparedAt && <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs">draft</span>}
                    </td>
                    <td className="py-2 pr-3">
                      {SEGMENT_INFO[c.segment as keyof typeof SEGMENT_INFO]?.label ?? RULE_INFO[c.segment as keyof typeof RULE_INFO]?.label ?? c.segment}
                    </td>
                    <td className="py-2 pr-3 text-right">{c.stats.prepared}</td>
                    <td className="py-2 pr-3 text-right">{c.stats.sent}</td>
                    <td className="py-2 pr-3 text-right">{c.stats.returned}</td>
                    <td className="py-2 pr-3 text-right">{c.stats.redeemed}</td>
                    <td className="py-2 text-right">{formatNpr(c.stats.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
