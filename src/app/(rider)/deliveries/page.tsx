import { requireTenant } from "@/server/auth";
import { formatNpr } from "@/features/billing/calc";
import { listMyDeliveries } from "@/features/delivery/server/service";
import { getMyAccount } from "@/features/delivery/server/dispatch";
import { AutoRefresh } from "@/components/auto-refresh";
import { riderStepAction, shareLocationAction } from "./actions";
import { ShareLocation } from "./share-location";

export const dynamic = "force-dynamic";

export default async function DeliveriesPage({ searchParams }: PageProps<"/deliveries">) {
  const ctx = await requireTenant("delivery.ride");
  const { error } = await searchParams;
  const [jobs, account] = await Promise.all([listMyDeliveries(ctx), getMyAccount(ctx)]);

  return (
    <div className="space-y-4">
      <AutoRefresh everyMs={10000} />
      <h1 className="text-2xl font-semibold">My deliveries</h1>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {(account.cashOwed !== 0 || account.payDue !== 0) && (
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-amber-50 p-3">
            <dt className="text-xs font-medium text-amber-900">Cash you are holding</dt>
            <dd className="text-lg font-semibold">{formatNpr(account.cashOwed)}</dd>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-3">
            <dt className="text-xs font-medium text-emerald-900">Pay owed to you</dt>
            <dd className="text-lg font-semibold">{formatNpr(account.payDue)}</dd>
          </div>
        </dl>
      )}

      {jobs.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-semibold">Nothing assigned to you right now.</p>
          <p className="mt-1 text-sm text-stone-500">New deliveries appear here by themselves.</p>
        </div>
      ) : (
        jobs.map((job) => (
          <section key={job.id} className="card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                Delivery #{job.number}
                {job.run && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Stop {job.run.stop} of {job.run.of}</span>}
              </h2>
              <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
                {job.status === "PREPARING" ? "Being prepared" : "On the way"}
              </span>
            </div>
            <div className="space-y-1">
              {job.customerName && <p className="font-medium">{job.customerName}</p>}
              <p className="text-stone-700">{job.address}</p>
              {job.zone && <p className="text-sm text-stone-500">Area: {job.zone}</p>}
            </div>
            <a
              href={`tel:${job.phone}`}
              className="flex min-h-12 items-center justify-center rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-700"
            >
              Call {job.phone}
            </a>
            <ul className="space-y-0.5 text-sm">
              {job.items.map((i, idx) => (
                <li key={idx}>
                  {i.quantity} × {i.name}
                  {i.addOns.length > 0 && <span className="text-stone-500"> ({i.addOns.join(", ")})</span>}
                </li>
              ))}
            </ul>
            <p className={`rounded-xl p-3 text-center text-sm font-semibold ${job.paid ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
              {job.paid ? "Already paid. Do not collect cash." : `Collect ${formatNpr(job.collect)}`}
            </p>

            {job.status === "PREPARING" ? (
              <form action={riderStepAction.bind(null, job.id)}>
                <input type="hidden" name="action" value="PICKED_UP" />
                <button className="min-h-12 w-full rounded-xl bg-orange-600 font-semibold text-white hover:bg-orange-700">I have picked it up</button>
              </form>
            ) : (
              <>
                <ShareLocation orderId={job.id} send={shareLocationAction} />
                <form action={riderStepAction.bind(null, job.id)}>
                  <input type="hidden" name="action" value="DELIVERED" />
                  <button className="min-h-12 w-full rounded-xl bg-emerald-600 font-semibold text-white hover:bg-emerald-700">Delivered</button>
                </form>
              </>
            )}
            <form action={riderStepAction.bind(null, job.id)} className="text-center">
              <input type="hidden" name="action" value="FAILED" />
              <button className="text-sm text-red-700 underline">I could not deliver it</button>
            </form>
          </section>
        ))
      )}
    </div>
  );
}
