import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { getRules, previewRule } from "@/features/campaigns/server/automation";
import { RULE_INFO, SEND_FROM_HOUR, SEND_UNTIL_HOUR } from "@/features/campaigns/automation";
import { saveRuleAction } from "../actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

export default async function AutomaticCampaignsPage({ searchParams }: PageProps<"/campaigns/automatic">) {
  const ctx = await requireTenant("campaign.manage");
  const { error, note } = await searchParams;
  const { rules, provider, canAutoSend } = await getRules(ctx);
  const previews = await Promise.all(rules.map((r) => previewRule(ctx, r.kind)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/campaigns" className="text-sm text-stone-500 hover:underline">
          ← Campaigns
        </Link>
        <h1 className="text-xl font-semibold">Automatic campaigns</h1>
      </div>

      <p className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
        Each rule is <strong>off until you switch it on</strong>. Once a day, between {SEND_FROM_HOUR}am and {SEND_UNTIL_HOUR - 12}pm, it works out who should
        get the message. Only guests who agreed to offers and were confirmed by staff are included, nobody is messaged twice in a week, and each guest is
        left alone for the rule&apos;s waiting time. Choose whether the app only <em>prepares</em> the day&apos;s messages for staff to send, or
        <em> sends them by itself</em> through your messaging provider ({provider ? `${provider} is set up` : "none is set up on this server yet"}).
        Sending by itself can only be switched on by the owner.
      </p>

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

      {rules.map((r, i) => {
        const info = RULE_INFO[r.kind];
        const locked = r.autoSend && !canAutoSend; // text that is sent by itself is only changed by the owner
        return (
          <form key={r.kind} action={saveRuleAction.bind(null, r.kind)} className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-lg font-semibold">{info.label}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs ${r.enabled ? (r.autoSend ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900") : "bg-stone-200"}`}>
                {r.enabled ? (r.autoSend ? "on · sends by itself" : "on · prepares for staff") : "off"}
              </span>
            </div>
            <p className="text-sm text-stone-600">{info.description}</p>
            <p className="text-sm text-stone-500">Would reach {previews[i]!.count} guest{previews[i]!.count === 1 ? "" : "s"} today (nothing is sent by looking at this).</p>

            <fieldset disabled={locked} className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={r.enabled} className="mt-1 h-4 w-4" />
                <span>
                  <strong>Switch this rule on.</strong>
                </span>
              </label>
              <label className="block text-sm font-medium">
                What happens
                <select name="mode" defaultValue={r.autoSend ? "send" : "prepare"} className={input}>
                  <option value="prepare">Prepare the messages for staff to send</option>
                  <option value="send" disabled={!canAutoSend || !provider}>
                    Send them by itself{!canAutoSend ? " (owner only)" : !provider ? " (needs a messaging provider)" : ""}
                  </option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Message
                <textarea name="template" rows={3} maxLength={320} defaultValue={r.template} className={input} />
                <span className="text-xs font-normal text-stone-500">You can use {"{name}"}, {"{points}"}, {"{days}"} and {"{business}"}.</span>
              </label>
              <div className="flex flex-wrap gap-3">
                <label className="text-sm font-medium">
                  Bonus points
                  <input name="offerPoints" type="number" min={0} max={10000} defaultValue={r.offerPoints} className={input + " w-32"} />
                </label>
                <label className="text-sm font-medium">
                  Offer lasts (days)
                  <input name="offerDays" type="number" min={1} max={90} defaultValue={r.offerDays} className={input + " w-32"} />
                </label>
                <label className="text-sm font-medium">
                  Leave a guest alone for (days)
                  <input name="cooldownDays" type="number" min={7} max={365} defaultValue={r.cooldownDays} className={input + " w-32"} />
                </label>
              </div>
              <button className="min-h-11 rounded-lg bg-brand-600 px-4 font-medium text-white hover:bg-brand-700">Save</button>
            </fieldset>
            {locked && <p className="text-sm text-amber-800">This rule sends by itself, so only the owner can change it.</p>}
          </form>
        );
      })}
    </div>
  );
}
