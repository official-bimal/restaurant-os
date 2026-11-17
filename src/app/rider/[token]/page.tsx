import { notFound } from "next/navigation";
import { getRiderJob } from "@/features/delivery/server/service";
import { formatNpr } from "@/features/billing/calc";
import { riderAction, shareLocationByLinkAction } from "./actions";
import { LocationSharer } from "@/components/location-sharer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery", robots: { index: false, follow: false } };

export default async function RiderPage({ params, searchParams }: PageProps<"/rider/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;
  const job = await getRiderJob(token);
  if (!job) notFound();

  const finished = job.status === "DELIVERED" || job.status === "FAILED" || job.status === "CANCELLED";

  return (
    <main className="mx-auto min-h-screen max-w-md space-y-4 p-4">
      <header>
        <p className="text-sm text-stone-500">{job.businessName}</p>
        <h1 className="text-2xl font-semibold">Delivery #{job.number}</h1>
      </header>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="card space-y-2 p-4">
        {job.customerName && <p className="text-lg font-semibold">{job.customerName}</p>}
        <p className="text-stone-700">{job.address}</p>
        {job.zone && <p className="text-sm text-stone-500">Area: {job.zone}</p>}
        <a
          href={`tel:${job.phone}`}
          className="mt-2 flex min-h-12 items-center justify-center rounded-xl bg-blue-600 px-4 text-lg font-semibold text-white hover:bg-blue-700"
        >
          Call {job.phone}
        </a>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Items</h2>
        <ul className="space-y-1 text-sm">
          {job.items.map((i, idx) => (
            <li key={idx}>
              {i.quantity} × {i.name}
              {i.addOns.length > 0 && <span className="text-stone-500"> ({i.addOns.join(", ")})</span>}
            </li>
          ))}
        </ul>
        {job.note && <p className="mt-2 text-sm text-stone-600">Note: {job.note}</p>}
      </section>

      <section className={`rounded-2xl p-4 text-center ${job.paid ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
        {job.paid ? <p className="font-semibold">Already paid. Do not collect cash.</p> : <p className="text-lg font-semibold">Collect {formatNpr(job.collect)}</p>}
      </section>

      {finished ? (
        <p role="status" className="rounded-2xl bg-stone-100 p-4 text-center font-medium">
          {job.status === "DELIVERED" ? "Delivered. Thank you." : job.status === "FAILED" ? "Marked as not delivered." : "This order was cancelled."}
        </p>
      ) : (
        <div className="space-y-3">
          {job.status === "PREPARING" ? (
            <form action={riderAction.bind(null, token)}>
              <input type="hidden" name="action" value="PICKED_UP" />
              <button className="min-h-14 w-full rounded-2xl bg-orange-600 text-lg font-semibold text-white hover:bg-orange-700">I have picked it up</button>
            </form>
          ) : (
            <>
              <LocationSharer send={shareLocationByLinkAction.bind(null, token)} />
              <form action={riderAction.bind(null, token)}>
                <input type="hidden" name="action" value="DELIVERED" />
                <button className="min-h-14 w-full rounded-2xl bg-emerald-600 text-lg font-semibold text-white hover:bg-emerald-700">Delivered</button>
              </form>
            </>
          )}
          <form action={riderAction.bind(null, token)} className="text-center">
            <input type="hidden" name="action" value="FAILED" />
            <button className="text-sm text-red-700 underline">I could not deliver it</button>
          </form>
        </div>
      )}
    </main>
  );
}
