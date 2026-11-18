import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatNpr } from "@/features/billing/calc";
import { getOnlineStatus } from "@/features/online/server/service";
import { LangSwitch } from "@/app/t/[token]/lang";
import { cancelOrderAction } from "../../actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your order",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

const TONE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-900 ring-amber-200",
  ACCEPTED: "bg-green-50 text-green-900 ring-green-200",
  REJECTED: "bg-red-50 text-red-900 ring-red-200",
  CANCELLED: "bg-stone-100 text-stone-800 ring-stone-200",
  EXPIRED: "bg-stone-100 text-stone-800 ring-stone-200",
};

export default async function OnlineStatusPage({ params, searchParams }: PageProps<"/o/[token]/status/[tracking]">) {
  const { token, tracking } = await params;
  const { note } = await searchParams;
  const s = await getOnlineStatus(token, tracking);

  if (!s) {
    return (
      <main className="guest-dark min-h-screen">
        <div className="mx-auto max-w-lg p-4">
          <h1 className="mt-4 text-xl font-semibold">We could not find this order</h1>
          <p className="mt-2 text-stone-600">The link may be wrong or out of date. Please ask the restaurant.</p>
        </div>
      </main>
    );
  }
  const waiting = s.status === "PENDING" || (s.status === "ACCEPTED" && s.progress?.state !== "Completed" && s.progress?.state !== "Cancelled");

  return (
    <main className="guest-dark min-h-screen">
      <div className="mx-auto max-w-lg space-y-4 p-4">
        {waiting && <AutoRefresh everyMs={5000} live={false} />}
        <LangSwitch />
        <header>
          <h1 className="text-2xl font-semibold">{s.businessName}</h1>
          <p className="text-stone-600">{s.branchName} · {s.type === "DELIVERY" ? "Delivery" : "Pickup"}</p>
        </header>

        {typeof note === "string" && (
          <p role="status" className="rounded-xl bg-stone-100 p-3 text-sm text-stone-800">
            {note}
          </p>
        )}

        <section aria-live="polite" className={`rounded-2xl p-4 ring-1 ${TONE[s.status] ?? ""}`}>
          <h2 className="text-lg font-semibold">{s.status === "ACCEPTED" && s.progress ? s.progress.state : s.title}</h2>
          {s.detail && <p className="mt-1 text-sm">{s.detail}</p>}
          {(s.status === "PENDING" || s.status === "ACCEPTED") && <p className="mt-2 text-sm">{s.prep}</p>}
          {s.type === "DELIVERY" && s.progress?.trackUrlToken && (
            <Link href={`/track/${s.progress.trackUrlToken}`} className="mt-3 inline-flex min-h-11 items-center rounded-full bg-brand-600 px-4 font-medium text-white hover:bg-brand-700">
              Follow your delivery
            </Link>
          )}
        </section>

        <section aria-label="Your order" className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <ul className="divide-y divide-stone-100">
            {s.items.map((i) => (
              <li key={i.id} className="py-2 text-sm">
                {i.quantity} × {i.name}
                {i.addOnNames.length > 0 && <span className="block text-xs text-stone-500">{i.addOnNames.join(", ")}</span>}
              </li>
            ))}
          </ul>
          <dl className="mt-2 space-y-1 border-t border-stone-100 pt-2 text-sm">
            <div className="flex justify-between">
              <dt>Food</dt>
              <dd>{formatNpr(s.subtotal)}</dd>
            </div>
            {s.type === "DELIVERY" && (
              <div className="flex justify-between">
                <dt>Delivery</dt>
                <dd>{s.deliveryFee === 0 ? "free" : formatNpr(s.deliveryFee)}</dd>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <dt>Estimated total</dt>
              <dd>{formatNpr(s.total)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-stone-500">Includes service charge and VAT. You pay {s.type === "DELIVERY" ? "when it arrives" : "when you pick it up"}. The final bill is what the restaurant gives you.</p>
          {s.address && <p className="mt-2 text-sm text-stone-600">Deliver to: {s.address}</p>}
        </section>

        {s.canCancel && (
          <form action={cancelOrderAction.bind(null, token, tracking)}>
            <button className="min-h-11 w-full rounded-full border border-red-300 px-4 font-medium text-red-700">Cancel this order</button>
          </form>
        )}
        <Link href={`/o/${token}`} className="block text-center text-sm text-stone-500 underline">
          Order something else
        </Link>
      </div>
    </main>
  );
}
