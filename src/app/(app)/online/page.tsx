import QRCode from "qrcode";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatNpr } from "@/features/billing/calc";
import { getOnlineInbox, getOnlineSettings, getRecentOnline } from "@/features/online/server/service";
import { acceptAction, rejectAction, rotateLinkAction, saveSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const ago = (d: Date) => {
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};
const STATUS_LABEL: Record<string, string> = { ACCEPTED: "Accepted", REJECTED: "Rejected", CANCELLED: "Cancelled by customer", EXPIRED: "No answer in time" };

export default async function OnlinePage({ searchParams }: PageProps<"/online">) {
  const ctx = await requireTenant("order.edit");
  const q = await searchParams;
  const [inbox, recent, settings] = await Promise.all([getOnlineInbox(ctx), getRecentOnline(ctx), getOnlineSettings(ctx)]);
  const canManage = can(ctx.role, "branch.manage");
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const link = settings.token ? `${base}/o/${settings.token}` : null;
  const qr = link ? await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div>
        <h1 className="text-2xl font-semibold">Online orders</h1>
        <p className="text-sm text-stone-500">
          Orders customers send from your ordering page for {settings.name}. Accept one and it becomes a normal order (takeaway or delivery); the kitchen and the bill work as usual.
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

      <section aria-label="Waiting for you" className="space-y-3">
        <h2 className="text-lg font-semibold">Waiting for you ({inbox.length})</h2>
        {inbox.length === 0 && <p className="card p-4 text-sm text-stone-500">Nothing waiting. New online orders appear here by themselves.</p>}
        {inbox.map((o) => (
          <article key={o.id} className={`card space-y-2 p-4 ${o.stale ? "ring-2 ring-amber-300" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${o.type === "DELIVERY" ? "bg-blue-100 text-blue-900" : "bg-green-100 text-green-900"}`}>{o.type === "DELIVERY" ? "Delivery" : "Pickup"}</span>
                {o.customerName}
              </p>
              <p className={`text-sm ${o.stale ? "font-medium text-amber-800" : "text-stone-500"}`}>
                {ago(o.createdAt)}
                {o.stale && " · the customer has waited a long time"}
              </p>
            </div>
            <p className="text-sm text-stone-600">{o.customerPhone}</p>
            {o.type === "DELIVERY" && (
              <p className="text-sm">
                {o.address}
                {o.deliveryZoneName && <span className="text-stone-500"> · {o.deliveryZoneName}</span>}
              </p>
            )}
            <ul className="divide-y divide-stone-100 text-sm">
              {o.items.map((i) => (
                <li key={i.id} className="py-1.5">
                  {i.quantity} × {i.name}
                  {i.addOnNames.length > 0 && <span className="text-stone-500"> ({i.addOnNames.join(", ")})</span>}
                  {i.note && <span className="block text-xs text-stone-500">{i.note}</span>}
                </li>
              ))}
            </ul>
            {o.note && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Note: {o.note}</p>}
            <p className="text-sm">
              Food {formatNpr(o.subtotal)}
              {o.type === "DELIVERY" && <> · delivery {o.deliveryFee ? formatNpr(o.deliveryFee) : "free"}</>} · pays {o.type === "DELIVERY" ? "at the door" : "at pickup"}
            </p>
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <form action={acceptAction.bind(null, o.id)}>
                <button className="min-h-11 rounded-lg bg-green-700 px-5 font-medium text-white hover:bg-green-800">Accept</button>
              </form>
              <form action={rejectAction.bind(null, o.id)} className="flex items-end gap-2">
                <label className="text-xs font-medium">
                  Reason (the customer sees it)
                  <input name="reason" maxLength={200} placeholder="We have run out of momo" className="mt-1 block w-60 rounded-lg border border-stone-300 px-2 py-2 text-sm" />
                </label>
                <button className="min-h-11 rounded-lg border border-red-300 px-4 font-medium text-red-700">Reject</button>
              </form>
            </div>
          </article>
        ))}
      </section>

      {recent.length > 0 && (
        <section aria-label="Recent" className="space-y-2">
          <h2 className="text-lg font-semibold">Recent</h2>
          <ul className="card divide-y divide-stone-100 text-sm">
            {recent.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  {o.customerName} · {o.type === "DELIVERY" ? "delivery" : "pickup"} · {formatNpr(o.subtotal)}
                </span>
                <span className="text-stone-500">
                  {STATUS_LABEL[o.status] ?? o.status} · {ago(o.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && (
        <section aria-label="Settings" className="card space-y-4 p-4">
          <h2 className="text-lg font-semibold">Online ordering for {settings.name}</h2>
          <form action={saveSettingsAction} className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="h-4 w-4" /> Take online orders at this branch
            </label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="pickup" defaultChecked={settings.pickup} className="h-4 w-4" /> Pickup
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="delivery" defaultChecked={settings.delivery} className="h-4 w-4" /> Delivery (uses your delivery pricing)
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Smallest order (Rs, food only; 0 for none)
                <input name="minOrder" type="number" min={0} step="1" defaultValue={settings.minOrder / 100} className={input} />
              </label>
              <label className="text-sm font-medium">
                Tell customers to expect it in (minutes)
                <input name="prepMinutes" type="number" min={5} max={240} step="5" defaultValue={settings.prepMinutes} className={input} />
              </label>
            </div>
            <label className="block text-sm font-medium">
              A line at the top of the page (optional)
              <input name="notice" maxLength={200} defaultValue={settings.notice ?? ""} placeholder="Delivery until 8pm. Closed on Tuesdays." className={input} />
            </label>
            <button className="min-h-11 rounded-lg bg-brand-600 px-4 font-medium text-white hover:bg-brand-700">Save</button>
          </form>

          {link && qr ? (
            <div className="grid gap-4 border-t border-stone-100 pt-4 sm:grid-cols-[auto,1fr]">
              <div role="img" aria-label="QR code for the online ordering page" className="w-40 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="space-y-2 text-sm">
                <p className="font-medium">Your ordering link</p>
                <p className="break-all rounded-lg bg-stone-100 p-2 font-mono text-xs">{link}</p>
                <p className="text-stone-600">Share it on your page, in messages, or print the QR code. {settings.enabled ? "" : "Online ordering is switched off, so it shows a closed message for now."}</p>
                <form action={rotateLinkAction}>
                  <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm">Make a new link (the old one stops working)</button>
                </form>
              </div>
            </div>
          ) : (
            <p className="border-t border-stone-100 pt-4 text-sm text-stone-500">Switch online ordering on and save to get your link and QR code.</p>
          )}
        </section>
      )}
    </div>
  );
}
