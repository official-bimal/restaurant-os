import { notFound } from "next/navigation";
import { getTracking } from "@/features/delivery/server/service";
import { AutoRefresh } from "@/components/auto-refresh";
import { DeliveryMap } from "@/components/delivery-map";

export const dynamic = "force-dynamic";
export const metadata = { title: "Track your order", robots: { index: false, follow: false } };

const LABEL = { PREPARING: "Being prepared", OUT_FOR_DELIVERY: "On the way", DELIVERED: "Delivered" } as const;

export default async function TrackPage({ params }: PageProps<"/track/[token]">) {
  const { token } = await params;
  const t = await getTracking(token);
  if (!t) notFound();

  const failed = t.status === "FAILED";
  const cancelled = t.status === "CANCELLED";
  const at = t.steps.indexOf(t.status as (typeof t.steps)[number]);

  return (
    <main className="mx-auto min-h-screen max-w-md space-y-5 p-4 sm:p-6">
      <AutoRefresh everyMs={8000} live={false} />
      <header>
        <p className="text-sm text-stone-500">{t.businessName}</p>
        <h1 className="text-2xl font-semibold">Order #{t.number}</h1>
      </header>

      {cancelled || failed ? (
        <p role="status" className="rounded-2xl bg-red-50 p-4 text-red-800">
          {cancelled ? "This order was cancelled." : "We could not deliver this order. Please call the restaurant."}
        </p>
      ) : (
        <ol className="card divide-y divide-stone-100" aria-label="Delivery progress">
          {t.steps.map((step, i) => {
            const done = i < at || t.status === "DELIVERED";
            const current = i === at && t.status !== "DELIVERED";
            return (
              <li key={step} className="flex items-center gap-3 p-4" aria-current={current ? "step" : undefined}>
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
                    done ? "bg-emerald-500 text-white" : current ? "bg-orange-500 text-white" : "bg-stone-200 text-stone-500"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className={current || done ? "font-medium" : "text-stone-500"}>{LABEL[step]}</span>
                {step === "OUT_FOR_DELIVERY" && current && t.riderFirstName && (
                  <span className="ml-auto text-sm text-stone-500">with {t.riderFirstName}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {t.status === "OUT_FOR_DELIVERY" && (
        <DeliveryMap branch={t.map.branch} destination={t.map.destination} rider={t.map.rider} riderAgeMinutes={t.map.riderAgeMinutes} branchLabel={t.businessName} />
      )}

      {t.location && (
        <p className="card p-4 text-sm">
          Your rider was seen {t.location.ageMinutes < 1 ? "just now" : `${t.location.ageMinutes} min ago`}.{" "}
          <a href={t.location.url} target="_blank" rel="noreferrer" className="font-medium text-blue-700 underline">
            See on a map
          </a>
        </p>
      )}

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Your order</h2>
        <ul className="space-y-1 text-sm">
          {t.items.map((i, idx) => (
            <li key={idx}>
              {i.quantity} × {i.name}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
