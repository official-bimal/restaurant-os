import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { getCampaign } from "@/features/campaigns/server/service";
import { SEGMENT_INFO } from "@/features/campaigns/segments";
import { RULE_INFO } from "@/features/campaigns/automation";
import { formatNpr } from "@/features/billing/calc";
import { getSendStatus } from "@/features/messaging/server/send";
import { markSentAction, optOutAction, prepareCampaignAction, sendCampaignAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params, searchParams }: PageProps<"/campaigns/[id]">) {
  const ctx = await requireTenant("campaign.manage");
  const { id } = await params;
  const { error, note } = await searchParams;

  let data;
  try {
    data = await getCampaign(ctx, id);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const { campaign, stats, messages } = data;
  const queued = messages.filter((m) => m.status === "QUEUED" && m.mayMessage);
  const send = await getSendStatus(ctx, campaign.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/campaigns" className="text-sm text-stone-500 hover:underline">
          ← Campaigns
        </Link>
        <h1 className="text-xl font-semibold">{campaign.name}</h1>
        <span className="text-sm text-stone-500">
          For {SEGMENT_INFO[campaign.segment as keyof typeof SEGMENT_INFO]?.label ?? RULE_INFO[campaign.segment as keyof typeof RULE_INFO]?.label ?? campaign.segment}
        </span>
      </div>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {typeof note === "string" && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {note}
        </p>
      )}

      <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="font-semibold">Message</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm">{campaign.template}</p>
        <p className="mt-2 text-sm text-stone-600">
          {campaign.offerPoints > 0
            ? `Offer: ${campaign.offerPoints} bonus points if they pay within ${campaign.offerDays} days of being sent this.`
            : "No offer attached."}
        </p>
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {[
          ["Prepared", String(stats.prepared)],
          ["Sent", String(stats.sent)],
          ["Came back", String(stats.returned)],
          ["Claimed offer", String(stats.redeemed)],
          ["Points given", String(stats.pointsGiven)],
          ["Sales from claims", formatNpr(stats.revenue)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-white p-3 border border-stone-200 shadow-sm">
            <dt className="text-xs text-stone-500">{k}</dt>
            <dd className="text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      {!campaign.preparedAt ? (
        <form action={prepareCampaignAction.bind(null, campaign.id)} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <h2 className="font-semibold">Prepare the messages</h2>
          <p className="mt-1 text-sm text-stone-600">
            This works out who is in the group today and writes each person&apos;s message. It sends nothing. People who have not
            confirmed their agreement, and anyone already messaged in the last 7 days, are left out. You can do this once.
          </p>
          <button className="mt-3 min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Prepare messages</button>
        </form>
      ) : (
        <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">
              Messages ({messages.length}) · {queued.length} still to send
            </h2>
            {queued.length > 0 && (
              <a href={`/campaigns/${campaign.id}/export`} className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 text-sm">
                Download list (CSV)
              </a>
            )}
          </div>
          {send.provider && send.allowed && (
            <div className="mb-3 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
              {send.ready > 0 ? (
                <form action={sendCampaignAction.bind(null, campaign.id)} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="expected" value={send.ready} />
                  <p className="mr-auto">
                    Send <strong>{send.ready}</strong> message{send.ready === 1 ? "" : "s"} now through {send.provider}? Each person&apos;s consent is
                    checked again as it goes. This cannot be undone.
                  </p>
                  <button className="min-h-10 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">
                    Yes, send {send.ready}
                  </button>
                </form>
              ) : (
                <p className="text-stone-600">
                  Nothing to send through {send.provider} right now{send.remainingToday === 0 ? " (daily limit reached)" : ""}.
                </p>
              )}
            </div>
          )}
          {!send.provider && queued.length > 0 && (
            <p className="mb-3 text-xs text-stone-500">
              Automatic sending is off. Send each message by hand below, or ask the owner to set a messaging provider.
            </p>
          )}
          {messages.length === 0 ? (
            <p className="text-sm text-stone-500">Nobody in this group has agreed to offers yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {messages.map((m) => (
                <li key={m.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{m.customer.name ?? "No name"}</strong>
                    <span className="text-stone-500">{m.customer.phone}</span>
                    {m.status === "SENT" && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
                        sent{m.redeemedAt ? " · came back" : ""}
                      </span>
                    )}
                    {!m.mayMessage && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">no longer agrees: do not send</span>
                    )}
                  </div>
                  <p className="mt-1 rounded-lg bg-stone-50 p-2">{m.text}</p>
                  {m.status === "QUEUED" && m.mayMessage && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <a
                        href={`sms:${m.customer.phone}?body=${encodeURIComponent(m.text)}`}
                        className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5"
                      >
                        Open in messages
                      </a>
                      <form action={markSentAction.bind(null, campaign.id, m.id)}>
                        <button className="min-h-9 rounded-lg bg-brand-600 hover:bg-brand-700 px-3 text-white">I sent it</button>
                      </form>
                      <form action={optOutAction.bind(null, campaign.id, m.id)}>
                        <button className="min-h-9 text-xs text-red-700 underline">They asked us to stop</button>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
