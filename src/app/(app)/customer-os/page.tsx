import { requireTenant } from "@/server/auth";
import { getLinkStatus } from "@/features/customeros/server/link";
import { connectAction, disconnectAction, pauseAction, retryFailedAction, sendNowAction } from "./actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const btn = "min-h-11 rounded-lg border border-stone-300 px-4 text-sm font-medium";
const when = (d: Date | null) => (d ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never");

export default async function CustomerOsPage({ searchParams }: PageProps<"/customer-os">) {
  const ctx = await requireTenant("owner.control");
  const q = await searchParams;
  const s = await getLinkStatus(ctx);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Customer OS</h1>
        <p className="text-sm text-stone-500">
          Connect your Customer OS so every paid bill with a customer is recorded there as a purchase and earns loyalty points. Customer OS then holds your customers and their points, and this app reads the points back.
        </p>
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

      {s.connected && (
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Connection</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${s.enabled && !s.keyUnreadable ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"}`}>
              {s.keyUnreadable ? "Key needs to be entered again" : s.enabled ? "Sending" : "Paused"}
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-stone-500">Address</dt><dd className="break-all">{s.baseUrl}</dd></div>
            <div><dt className="text-stone-500">Key</dt><dd className="font-mono">{s.keyPrefix}…</dd></div>
            <div><dt className="text-stone-500">Last successful send</dt><dd>{when(s.lastOkAt)}</dd></div>
            <div><dt className="text-stone-500">Bills</dt><dd>{s.counts.sent} sent · {s.counts.pending} waiting · {s.counts.failed} failed</dd></div>
          </dl>
          {s.lastError && (s.counts.pending > 0 || s.counts.failed > 0) && (
            <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Last problem: {s.lastError}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <form action={sendNowAction}><button className={btn}>Send waiting bills now</button></form>
            {s.counts.failed > 0 && <form action={retryFailedAction}><button className={btn}>Try the {s.counts.failed} failed again</button></form>}
            <form action={pauseAction.bind(null, !s.enabled)}><button className={btn}>{s.enabled ? "Pause sending" : "Resume sending"}</button></form>
            <form action={disconnectAction}><button className={`${btn} text-red-800`}>Disconnect</button></form>
          </div>
        </section>
      )}

      <section className="card space-y-3 p-4">
        <h2 className="text-lg font-semibold">{s.connected ? "Change the key or address" : "Connect"}</h2>
        <p className="text-sm text-stone-600">In Customer OS, open Settings, then Integrations, and make a key. Paste it here once. It is stored encrypted and never shown again.</p>
        <form action={connectAction} className="space-y-3">
          <label className="block text-sm font-medium">
            Customer OS address
            <input name="baseUrl" required placeholder="https://customers.example.com" defaultValue={s.baseUrl ?? ""} inputMode="url" autoComplete="off" className={input} />
          </label>
          <label className="block text-sm font-medium">
            Key
            <input name="key" required type="password" placeholder="cos_live_…" autoComplete="off" className={input} />
          </label>
          <button className="min-h-11 rounded-lg bg-brand-600 px-4 font-medium text-white hover:bg-brand-700">Check and connect</button>
        </form>
      </section>

      <section className="card space-y-2 p-4 text-sm text-stone-600">
        <h2 className="text-lg font-semibold text-stone-900">What happens</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Customer OS gives the points by its own loyalty program. This app stops giving points itself while connected, so a bill is never rewarded twice.</li>
          <li>Each paid bill with a customer is sent after it is saved. If Customer OS is down or you have no internet, billing carries on and the bills wait and are sent later. The same bill is never counted twice.</li>
          <li>The amount sent is the food and drink on the bill, not the delivery fee.</li>
          <li>Spending points as a discount on a bill is not connected yet. Refunds do not take points back yet.</li>
        </ul>
      </section>
    </div>
  );
}
